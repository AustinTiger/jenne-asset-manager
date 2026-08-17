/**
 * Scans active World Documents and Compendium Pack indexes to find matching unique Asset IDs
 * and updates their "imported" status in the catalog.
 */
export class ImportTracker {
  /**
   * Cross-references the catalog's asset IDs with imported documents in World and Compendiums.
   * @param {object} catalog - The in-memory Asset Catalog
   */
  static async updateImportStatus(catalog) {
    const debug = game.settings.get("jenne-asset-manager", "debugMode");
    const startTime = performance.now();

    // Map: assetId -> documentUuid
    const importedMap = new Map();

    // 1. Scan World Documents
    this._scanWorldCollection(game.actors, "Actor", importedMap);
    this._scanWorldCollection(game.scenes, "Scene", importedMap);
    this._scanWorldCollection(game.items, "Item", importedMap);
    this._scanWorldCollection(game.tables, "RollTable", importedMap);
    this._scanWorldCollection(game.macros, "Macro", importedMap);
    
    // Playlists are handled differently due to nested sounds
    for (const playlist of game.playlists) {
      const playlistAssetId = playlist.getFlag("jenne-asset-manager", "assetId");
      if (playlistAssetId) importedMap.set(playlistAssetId, playlist.uuid);

      for (const sound of playlist.sounds) {
        const soundAssetId = sound.getFlag("jenne-asset-manager", "assetId");
        if (soundAssetId) importedMap.set(soundAssetId, sound.uuid);
      }
    }

    // 2. Scan Compendiums (Highly optimized using Compendium Indexing)
    for (const pack of game.packs) {
      try {
        const index = await pack.getIndex({ fields: ["flags.jenne-asset-manager"] });
        for (const entry of index) {
          const assetId = entry.flags?.["jenne-asset-manager"]?.assetId;
          if (assetId) {
            importedMap.set(assetId, `Compendium.${pack.metadata.id}.${pack.documentName}.${entry._id}`);
          }
        }
      } catch (err) {
        if (debug) console.warn(`Jenne Asset Manager | Failed to index compendium ${pack.collection}:`, err);
      }
    }

    // 3. Update the Scanned Catalog
    let matchCount = 0;
    for (const publisher of catalog.publishers) {
      for (const pack of publisher.packs) {
        for (const asset of pack.assets) {
          if (importedMap.has(asset.id)) {
            asset.imported = true;
            asset.importedDocumentId = importedMap.get(asset.id);
            matchCount++;
          } else {
            asset.imported = false;
            asset.importedDocumentId = null;
          }
        }
      }
    }

    if (debug) {
      const duration = (performance.now() - startTime).toFixed(2);
      console.log(`Jenne Asset Manager | Tracker scan complete in ${duration}ms. Found ${matchCount} matching imported documents.`);
    }
  }

  /**
   * Scans a standard World Document collection and populates the imported Map.
   */
  static _scanWorldCollection(collection, typeString, map) {
    if (!collection) return;
    for (const doc of collection) {
      const assetId = doc.getFlag("jenne-asset-manager", "assetId");
      if (assetId) {
        map.set(assetId, doc.uuid);
      }
    }
  }
}
