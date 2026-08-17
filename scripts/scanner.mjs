import { generateAssetId } from "./id-generator.mjs";

const SUPPORTED_EXTENSIONS = {
  image: ["webp", "png", "jpg", "jpeg", "gif"],
  audio: ["ogg", "mp3", "wav", "m4a", "flac", "opus"],
  video: ["webm", "mp4"],
  json: ["json"]
};

const ALL_EXTENSIONS = Object.values(SUPPORTED_EXTENSIONS).flat();

/**
 * Normalizes a directory name into a capital case display name.
 * e.g., "beneos-battlemaps" -> "Beneos Battlemaps"
 */
function normalizeName(name) {
  if (!name) return "Unknown";
  return name
    .replace(/[_-]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

/**
 * Scans directories and compendiums, building a catalog index.
 */
export class LocalScanner {
  /**
   * Helper to retrieve all source directories/compendiums from module settings
   * @returns {object[]} - Array of source configurations
   */
  static getSourcePaths() {
    return game.settings.get("jenne-asset-manager", "sourceDirectoriesList") || [];
  }

  /**
   * Performs the scan on all configured sources
   * @returns {Promise<object>} - The Asset Catalog
   */
  static async scanAll() {
    const debug = game.settings.get("jenne-asset-manager", "debugMode");
    if (debug) console.log("Jenne Asset Manager | Scanner started");

    const catalog = { publishers: [] };
    const sources = this.getSourcePaths();

    for (const source of sources) {
      try {
        const mode = source.sourceMode || "directory";
        const type = source.type || "actors";
        const tags = Array.isArray(source.tags) ? source.tags : [];

        if (mode === "directory") {
          const path = source.path;
          if (!path) continue;
          if (debug) console.log(`Jenne Asset Manager | Scanning root path: ${path} (Type: ${type}, Tags: ${tags.join(",")})`);
          await this.scanRecursive(path, catalog, debug, type, tags);
        } else if (mode === "compendium") {
          const compendiumId = source.compendium;
          if (!compendiumId) continue;
          if (debug) console.log(`Jenne Asset Manager | Scanning compendium pack: ${compendiumId} (Type: ${type}, Tags: ${tags.join(",")})`);
          await this.scanCompendium(compendiumId, catalog, debug, type, tags);
        }
      } catch (err) {
        console.error(`Jenne Asset Manager | Error scanning source:`, err, source);
      }
    }

    if (debug) console.log("Jenne Asset Manager | Scan complete, catalog generated:", catalog);
    return catalog;
  }

  /**
   * Recursively scans folders looking for assets and metadata files
   */
  static async scanRecursive(dirPath, catalog, debug, forcedType = null, tags = []) {
    let browseResult;
    try {
      const FilePickerClass = globalThis.foundry?.applications?.apps?.FilePicker || globalThis.FilePicker;
      browseResult = await FilePickerClass.browse("data", dirPath);
    } catch (e) {
      if (debug) console.warn(`Jenne Asset Manager | Could not browse directory: ${dirPath}`, e);
      return;
    }

    // 1. Check if there is an ignore file
    const hasIgnore = browseResult.files.some(f => f.endsWith("ignore.info") || f.endsWith(".ignore"));
    if (hasIgnore) {
      if (debug) console.log(`Jenne Asset Manager | Ignoring directory: ${dirPath}`);
      return;
    }

    // 2. Check for metadata configuration file (jenne.json or moulinette.json)
    let meta = null;
    const metaFile = browseResult.files.find(
      (f) => f.endsWith("jenne.json") || f.endsWith("moulinette.json")
    );

    if (metaFile) {
      try {
        const response = await fetch(metaFile + "?ms=" + Date.now(), { cache: "no-store" });
        if (response.ok) {
          const rawData = await response.json();
          // Normalize legacy Moulinette or custom Jenne properties
          meta = {
            publisher: rawData.publisher || rawData.creator || null,
            packName: rawData.packName || rawData.pack || null,
            type: rawData.type || null,
            isBeneosLegacy: rawData.isBeneosLegacy || rawData.isBeneos || (rawData.publisher && rawData.publisher.toLowerCase().includes("beneos")) || false
          };
        }
      } catch (err) {
        if (debug) console.warn(`Jenne Asset Manager | Failed to load metadata config ${metaFile}`, err);
      }
    }

    // 3. Process files in current directory if this folder contains assets
    const assets = [];
    for (const file of browseResult.files) {
      const ext = file.split(".").pop().toLowerCase();
      if (!ALL_EXTENSIONS.includes(ext)) continue;

      let type = "mixed";
      if (SUPPORTED_EXTENSIONS.image.includes(ext)) type = "image";
      else if (SUPPORTED_EXTENSIONS.audio.includes(ext)) type = "audio";
      else if (SUPPORTED_EXTENSIONS.video.includes(ext)) type = "video";
      else if (SUPPORTED_EXTENSIONS.json.includes(ext)) type = "json";

      // Skip config files
      if (file.endsWith("jenne.json") || file.endsWith("moulinette.json")) continue;

      const relativePath = decodeURIComponent(file);
      const filename = relativePath.split("/").pop();

      assets.push({
        id: generateAssetId(relativePath),
        filename: filename,
        relativePath: relativePath,
        type: type,
        tags: [...tags],
        isCompendium: false,
        imported: false,
        importedDocumentId: null
      });
    }

    // If assets exist, add this folder as a pack
    if (assets.length > 0) {
      // Determine Publisher and Pack names
      let publisherName = "Local Assets";
      let packName = dirPath.split("/").pop() || "Root";

      if (meta) {
        publisherName = meta.publisher || publisherName;
        packName = meta.packName || packName;
      } else {
        // Fallback: Smart parsing if folders are named like publisher-pack-name
        const parts = dirPath.split("/");
        const folderName = parts.pop();
        if (folderName.includes("-battlemaps-") || folderName.includes("-tokens-")) {
          const splitIdx = folderName.indexOf("-battlemaps-") !== -1 
            ? folderName.indexOf("-battlemaps-") 
            : folderName.indexOf("-tokens-");
          
          publisherName = normalizeName(folderName.substring(0, splitIdx));
          packName = normalizeName(folderName.substring(splitIdx + 1));
        } else if (parts.length > 0) {
          // Use parent directory as publisher and current directory as pack
          const parentFolder = parts.pop();
          if (parentFolder && parentFolder !== "modules" && parentFolder !== "moulinette" && parentFolder !== "adventures") {
            publisherName = normalizeName(parentFolder);
          }
          packName = normalizeName(folderName);
        }
      }

      // Add to Catalog
      let publisher = catalog.publishers.find((p) => p.name === publisherName);
      if (!publisher) {
        publisher = { name: publisherName, packs: [] };
        catalog.publishers.push(publisher);
      }

      let pack = publisher.packs.find((p) => p.path === dirPath);
      if (!pack) {
        pack = {
          name: packName,
          path: dirPath,
          type: forcedType || meta?.type || "mixed",
          isBeneosLegacy: meta?.isBeneosLegacy || publisherName.toLowerCase().includes("beneos"),
          isCompendium: false,
          assets: []
        };
        publisher.packs.push(pack);
      }
      pack.assets.push(...assets);
    }

    // 4. Recurse into subdirectories
    for (const subDir of browseResult.dirs) {
      await this.scanRecursive(subDir, catalog, debug, forcedType, tags);
    }
  }

  /**
   * Scans a compendium pack and indexes its documents as assets in the catalog
   */
  static async scanCompendium(packId, catalog, debug, forcedType, tags = []) {
    const pack = game.packs.get(packId);
    if (!pack) {
      if (debug) console.warn(`Jenne Asset Manager | Compendium pack ${packId} not found.`);
      return;
    }

    // Get index with image and type fields
    const index = await pack.getIndex({ fields: ["img", "thumb", "type"] });
    const assets = [];

    for (const entry of index) {
      let imgPath = entry.img || entry.thumb || "";
      if (!imgPath) {
        if (pack.documentName === "Actor") imgPath = "icons/svg/mystery-man.svg";
        else if (pack.documentName === "Item") imgPath = "icons/svg/item-bag.svg";
        else imgPath = "";
      }

      let type = "image";
      if (pack.documentName === "Playlist") type = "audio";
      else if (["Macro", "RollTable", "JournalEntry", "Adventure"].includes(pack.documentName)) type = "json";

      const uuid = `Compendium.${packId}.${entry._id}`;

      assets.push({
        id: uuid,
        filename: entry.name,
        relativePath: imgPath || uuid,
        type: type,
        isCompendium: true,
        documentName: pack.documentName,
        uuid: uuid,
        tags: [...tags],
        imported: false,
        importedDocumentId: null
      });
    }

    if (assets.length > 0) {
      // Use standard names
      const publisherName = pack.metadata.packageName || "Compendiums";
      const packName = pack.metadata.label;

      let publisher = catalog.publishers.find((p) => p.name === publisherName);
      if (!publisher) {
        publisher = { name: publisherName, packs: [] };
        catalog.publishers.push(publisher);
      }

      let catalogPack = publisher.packs.find((p) => p.path === packId);
      if (!catalogPack) {
        catalogPack = {
          name: packName,
          path: packId,
          type: forcedType,
          isCompendium: true,
          assets: []
        };
        publisher.packs.push(catalogPack);
      }
      catalogPack.assets.push(...assets);
    }
  }
}
