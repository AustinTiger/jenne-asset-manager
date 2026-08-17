/**
 * Legacy Beneos Battlemaps Parser & Scene Packer Bridge
 * 
 * Re-integrates the original Beneos Scene Packer cloud pipeline.
 * When the user attempts to import a Beneos battlemap scene, this script
 * calls the Beneos API to fetch the layout data (walls, lighting, sounds, Monk's Active Tiles)
 * and leverages Scene Packer to assemble the scene.
 */
export async function parseBeneosPack(assets, targetPack, folderName = "") {
  const debug = game.settings.get("jenne-asset-manager", "debugMode");
  
  // 1. Verify ScenePacker is active
  if (!game.modules.get('scene-packer')?.active) {
    ui.notifications.error("ScenePacker module is required to import Beneos Battlemap scene packs.");
    throw new Error("ScenePacker is inactive");
  }

  // 2. Retrieve session / authentication from beneos-module settings
  let sessionId = "";
  try {
    sessionId = game.settings.get('beneos-module', 'beneos-cloud-foundry-id') || "";
  } catch (e) {
    if (debug) console.warn("Jenne Asset Manager | Could not read beneos-cloud-foundry-id setting:", e);
  }

  if (!sessionId) {
    ui.notifications.warn("No Beneos Cloud Foundry ID found. Please set your Foundry ID in the Beneos Module settings to import high-quality scene packs.");
  }

  // 3. Find the Beneos package ID from the assets relative path or folder structure
  // Usually, folders are named like ".../beneos_battlemaps/4k/105_ancient_monument"
  // The package ID is the number (e.g., 105 or "105_ancient_monument")
  let packageId = "";
  if (assets.length > 0) {
    const pathParts = assets[0].relativePath.split("/");
    // Traverse backwards to find the folder containing "beneos_battlemaps"
    const bmapIdx = pathParts.findIndex(p => p.toLowerCase() === "beneos_battlemaps");
    if (bmapIdx !== -1 && pathParts.length > bmapIdx + 2) {
      // Typically, pathParts[bmapIdx+2] is "105_ancient_monument" or "0105"
      packageId = pathParts[bmapIdx + 2];
    } else {
      // Fallback to directory name of first asset
      packageId = pathParts[pathParts.length - 2];
    }
  }

  // Clean packageId (e.g. "105_ancient_monument" -> 105)
  const numericMatch = packageId.match(/^0*(\d+)/);
  if (numericMatch) {
    packageId = numericMatch[1];
  }

  if (!packageId) {
    throw new Error("Could not determine Beneos Package ID from asset paths.");
  }

  if (debug) console.log(`Jenne Asset Manager | Importing Beneos package ID: ${packageId}`);

  // 4. Fetch the pack manifest from Beneos API
  const serverUrl = 'https://beneos.cloud';
  const apiEndpoint = `${serverUrl}/api-scenepacker.php`;

  ui.notifications.info(`Contacting Beneos Cloud for package ID ${packageId}...`);

  let packInfo = null;
  try {
    const response = await fetch(apiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        's': sessionId,
        'a': 'get_packinfo',
        'package': packageId
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP Error ${response.status}`);
    }

    const data = await response.json();
    if (data.status !== 'ok') {
      throw new Error(data.message || 'Failed to retrieve package information');
    }

    packInfo = data.packInfo;
  } catch (err) {
    console.error("Jenne Asset Manager | Failed to fetch packinfo from Beneos:", err);
    ui.notifications.error(`Beneos Cloud API error: ${err.message}. Standard scene fallback will be used.`);
    
    // Bypassing Scene Packer, proceed with a standard import of the background image
    return await fallbackStandardImport(assets, targetPack, folderName);
  }

  // 5. Append authentication to all manifest URLs so Scene Packer downloads them securely
  const authedPackInfo = {};
  for (const [fileKey, url] of Object.entries(packInfo)) {
    const separator = url.includes('?') ? '&' : '?';
    authedPackInfo[fileKey] = `${url}${separator}s=${sessionId}`;
  }

  // 6. Dynamically import and run Scene Packer's MoulinetteImporter
  try {
    const MoulinetteImporter = (await import('/modules/scene-packer/scripts/export-import/moulinette-importer.js')).default;
    
    const importer = new MoulinetteImporter({
      packInfo: authedPackInfo,
      sceneID: '',
      actorID: ''
    });

    ui.notifications.info("Executing Scene Packer import pipeline...");
    await importer.process();

    if (importer && typeof importer.close === "function") {
      importer.close();
    }
  } catch (err) {
    console.error("Jenne Asset Manager | Moulinette Importer execution failed:", err);
    ui.notifications.error(`Scene Packer failed: ${err.message}. Running standard import.`);
    return await fallbackStandardImport(assets, targetPack, folderName);
  }
}

/**
 * Fallback to standard scene import if the user has no internet or the Beneos API fails.
 */
async function fallbackStandardImport(assets, targetPack, folderName) {
  const images = assets.filter(a => a.type === "image" || a.type === "video");
  if (images.length === 0) return;
  
  // Import the images standardly as scene backgrounds
  const cls = CONFIG[targetPack.documentName].documentClass;
  const folderId = targetPack.folders.find(f => f.name === folderName)?.id || null;
  
  const documentsToCreate = images.map(asset => ({
    name: asset.filename.split(".").slice(0, -1).join(".") || asset.filename,
    folder: folderId,
    background: { src: asset.relativePath },
    grid: { type: 1, size: 100 },
    flags: {
      "jenne-asset-manager": {
        assetId: asset.id,
        relativePath: asset.relativePath
      }
    }
  }));

  await cls.createDocuments(documentsToCreate, { pack: targetPack.collection });
}
