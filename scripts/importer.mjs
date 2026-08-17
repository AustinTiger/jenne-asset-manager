import { parseBeneosPack } from "./legacy-beneos-parser.mjs";

/**
 * Gets or recursively creates folders within a target compendium pack.
 * 
 * @param {object} pack - The Compendium pack object
 * @param {string} folderPath - A slash-separated path like "Monsters/Goblins"
 * @returns {Promise<string|null>} - The ID of the deepest folder created/found
 */
async function getOrCreateCompendiumFolder(pack, folderPath) {
  if (!folderPath) return null;
  const folders = folderPath.split("/").map(f => f.trim()).filter(f => f.length > 0);
  
  let parentId = null;
  for (const f of folders) {
    // Look for existing folder under the current parent
    let folder = pack.folders.find(fol => fol.name === f && (fol.folder?.id === parentId || (!fol.folder && !parentId)));
    
    if (!folder) {
      folder = await Folder.create({
        name: f,
        type: pack.documentName,
        folder: parentId,
        pack: pack.collection
      });
    }
    parentId = folder.id;
  }
  return parentId;
}

/**
 * Batch imports selected assets from the GUI into a target compendium pack.
 * Supports updating existing documents to prevent duplicates.
 */
export async function batchImport(assets, targetPackId, folderName = "", isBeneosLegacy = false) {
  const pack = game.packs.get(targetPackId);
  if (!pack) throw new Error(`Target Compendium Pack "${targetPackId}" not found.`);
  if (pack.locked) throw new Error(`Target Compendium Pack "${pack.metadata.label}" is locked.`);

  // 1. Check if we need to run legacy Beneos parser
  if (isBeneosLegacy && pack.documentName === "Scene") {
    // Delegate to legacy parser
    return await parseBeneosPack(assets, pack, folderName);
  }

  // 2. Query folder structure inside the compendium
  const folderId = await getOrCreateCompendiumFolder(pack, folderName);

  // 3. Retrieve pack index to check for existing Unique IDs
  const index = await pack.getIndex({ fields: ["flags.jenne-asset-manager"] });
  const indexMap = new Map();
  for (const entry of index) {
    const assetId = entry.flags?.["jenne-asset-manager"]?.assetId;
    if (assetId) {
      indexMap.set(assetId, entry._id);
    }
  }

  const documentsToCreate = [];
  const documentsToUpdate = [];

  for (const asset of assets) {
    if (asset.isCompendium) {
      const srcDoc = await fromUuid(asset.uuid);
      if (srcDoc) {
        const docData = srcDoc.toObject();
        delete docData._id;
        docData.folder = folderId;
        docData.flags = docData.flags || {};
        docData.flags["jenne-asset-manager"] = {
          assetId: asset.id,
          uuid: asset.uuid,
          isCompendium: true
        };

        if (indexMap.has(asset.id)) {
          docData._id = indexMap.get(asset.id);
          documentsToUpdate.push(docData);
        } else {
          documentsToCreate.push(docData);
        }
      }
      continue;
    }

    const docName = asset.filename.split(".").slice(0, -1).join(".") || asset.filename;
    let docData = {
      name: docName,
      folder: folderId,
      flags: {
        "jenne-asset-manager": {
          assetId: asset.id,
          relativePath: asset.relativePath
        }
      }
    };

    // Construct properties based on document type
    switch (pack.documentName) {
      case "Actor":
        docData.type = "npc";
        docData.img = asset.relativePath;
        docData.prototypeToken = {
          texture: { src: asset.relativePath }
        };
        break;

      case "Scene":
        docData.background = { src: asset.relativePath };
        // Basic defaults for a newly generated scene grid
        docData.grid = {
          type: 1,
          size: 100
        };
        break;

      case "Item":
        // Fallback type for item
        docData.type = "feat";
        docData.img = asset.relativePath;
        break;

      case "Playlist":
        docData.sounds = [{
          name: docName,
          path: asset.relativePath,
          flags: {
            "jenne-asset-manager": {
              assetId: asset.id
            }
          }
        }];
        break;

      default:
        // Generic fallback for journals, tables, macros
        if (pack.documentName === "RollTable") {
          docData.formula = "1d6";
        } else if (pack.documentName === "JournalEntry") {
          docData.pages = [{
            name: docName,
            type: "text",
            text: { content: `<img src="${asset.relativePath}"/>` }
          }];
        } else if (pack.documentName === "Macro") {
          docData.type = "script";
          docData.command = `// Imported Jenne Asset: ${docName}\n// File: ${asset.relativePath}`;
        }
        break;
    }

    if (indexMap.has(asset.id)) {
      // Document already exists, prepare update object
      docData._id = indexMap.get(asset.id);
      documentsToUpdate.push(docData);
    } else {
      // New document
      documentsToCreate.push(docData);
    }
  }

  // 4. Execute creation and updates
  const cls = CONFIG[pack.documentName].documentClass;

  if (documentsToUpdate.length > 0) {
    await cls.updateDocuments(documentsToUpdate, { pack: pack.collection });
  }

  if (documentsToCreate.length > 0) {
    await cls.createDocuments(documentsToCreate, { pack: pack.collection });
  }
}
