import { BeneosAdapter } from "./adapters/beneos-adapter.mjs";

/**
 * Beneos Battlemaps Native Parser & Cloud Bridge
 * 
 * Uses the modern Beneos Cloud native installer pipeline from beneos-module via BeneosAdapter.
 * When the user imports a Beneos battlemap scene, this script leverages
 * BeneosNativeBattlemapInstaller to assemble the scene (walls, lighting, sounds, Monk's Active Tiles)
 * without requiring ScenePacker or Moulinette.
 */
export async function parseBeneosPack(assets, targetPack, folderName = "") {
  const debug = game.settings.get("jenne-asset-manager", "debugMode");
  
  // 1. Verify beneos-module is active
  if (!BeneosAdapter.isAvailable) {
    if (debug) console.warn("Jenne Asset Manager | beneos-module is not active. Falling back to standard scene import.");
    return await fallbackStandardImport(assets, targetPack, folderName);
  }

  // 2. Find the Beneos package ID from the assets relative path or folder structure
  let packageId = "";
  if (assets.length > 0) {
    const pathParts = assets[0].relativePath.split("/");
    const bmapIdx = pathParts.findIndex(p => p.toLowerCase() === "beneos_battlemaps" || p.toLowerCase() === "battlemaps");
    if (bmapIdx !== -1 && pathParts.length > bmapIdx + 2) {
      packageId = pathParts[bmapIdx + 2];
    } else {
      packageId = pathParts[pathParts.length - 2];
    }
  }

  // Clean packageId (e.g. "105_ancient_monument" -> 105 or "bm_0011")
  const numericMatch = packageId.match(/^0*(\d+)/);
  if (numericMatch) {
    packageId = numericMatch[1];
  }

  if (!packageId) {
    if (debug) console.warn("Jenne Asset Manager | Could not determine Beneos Package ID from asset paths. Using standard import.");
    return await fallbackStandardImport(assets, targetPack, folderName);
  }

  if (debug) console.log(`Jenne Asset Manager | Importing Beneos package via BeneosAdapter. Package ID: ${packageId}`);

  // 3. Delegate to BeneosAdapter
  try {
    ui.notifications.info(`Installing Beneos Battlemap pack ${packageId} natively...`);
    await BeneosAdapter.install({
      id: packageId,
      name: folderName || `Beneos Pack ${packageId}`,
      type: "scene"
    }, {
      packageId: packageId,
      label: folderName || `Beneos Pack ${packageId}`,
      overwrite: true
    });
    ui.notifications.info(`Beneos Battlemap pack ${packageId} installed successfully.`);
    return;
  } catch (err) {
    console.error("Jenne Asset Manager | Native Beneos Installer execution failed:", err);
  }

  // Fallback to standard scene creation if native installer is unavailable
  return await fallbackStandardImport(assets, targetPack, folderName);
}

/**
 * Fallback to standard scene import if beneos-module is inactive or offline.
 */
async function fallbackStandardImport(assets, targetPack, folderName) {
  const images = assets.filter(a => a.type === "image" || a.type === "video");
  if (images.length === 0) return;
  
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
