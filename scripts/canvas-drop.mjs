/**
 * Canvas Drag-and-Drop integration for Jenne Asset Manager
 * Intercepts dropped custom drag payloads on the canvas and dynamically
 * spawns Tokens or Tiles based on the GM's active layer selection.
 */
export function setupCanvasDrop() {
  Hooks.on("dropCanvasData", async (canvas, data) => {
    // 1. Verify this drop is meant for us
    if (data.type !== "JenneAsset") return true; // Pass through to other handlers

    if (!game.user.isGM) {
      ui.notifications.warn("Only GMs can place assets directly onto the canvas.");
      return false;
    }

    const debug = game.settings.get("jenne-asset-manager", "debugMode");
    if (debug) console.log("Jenne Asset Manager | Intercepted canvas drop data:", data);

    const activeScene = canvas.scene;
    if (!activeScene) {
      ui.notifications.warn("No active scene found to place the asset.");
      return false;
    }

    // 2. Snap coordinates to grid
    // snapMode 1 snips exactly to center of grid cells
    const snappedCoords = canvas.grid.getSnappedPoint({ x: data.x, y: data.y }, { mode: 1 });

    // 3. Detect target layer
    const activeLayerName = canvas.activeLayer?.options?.name;
    const isTokenLayer = activeLayerName === "tokens";
    const isTileLayer = activeLayerName === "tiles" || activeLayerName === "background" || activeLayerName === "foreground";

    if (isTokenLayer) {
      // Drop onto Tokens layer: Spawn a Token
      const actorName = data.filename.split(".").slice(0, -1).join(".") || data.filename;
      ui.notifications.info(`Placing Token: ${actorName}`);

      // Check if an Actor with this flag already exists in the World sidebar
      let actor = game.actors.find(
        (a) => a.getFlag("jenne-asset-manager", "assetId") === data.assetId
      );

      if (!actor) {
        if (debug) console.log(`Jenne Asset Manager | Creating new generic World Actor for token: ${actorName}`);
        // Create standard generic Actor in the sidebars to back the token
        actor = await Actor.create({
          name: actorName,
          type: "npc",
          img: data.relativePath,
          prototypeToken: {
            texture: { src: data.relativePath },
            name: actorName,
            width: 1,
            height: 1
          },
          flags: {
            "jenne-asset-manager": {
              assetId: data.assetId,
              relativePath: data.relativePath
            }
          }
        });
      }

      // Generate a Token Document object and create on scene
      const tokenDoc = await actor.getTokenDocument({ x: snappedCoords.x, y: snappedCoords.y });
      await activeScene.createEmbeddedDocuments("Token", [tokenDoc.toObject()]);

    } else if (isTileLayer) {
      // Drop onto Tiles layer: Spawn a Tile
      ui.notifications.info(`Placing Tile: ${data.filename}`);

      // Default Tile size (200x200 pixels) snapped to coordinates
      const tileData = {
        texture: { src: data.relativePath },
        x: snappedCoords.x - 100, // Center the tile at grid snapped coordinates
        y: snappedCoords.y - 100,
        width: 200,
        height: 200,
        flags: {
          "jenne-asset-manager": {
            assetId: data.assetId,
            relativePath: data.relativePath
          }
        }
      };

      await activeScene.createEmbeddedDocuments("Tile", [tileData]);

    } else {
      ui.notifications.warn("Please activate either the Tokens or Tiles controls in the sidebar before dropping assets.");
    }

    return false; // Prevent core VTT from loading or viewing dropped image paths in native browsers
  });
}
