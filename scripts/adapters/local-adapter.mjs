import { BaseSourceAdapter } from "./base-adapter.mjs";
import { generateAssetId } from "../id-generator.mjs";

/**
 * Local Filesystem Source Adapter
 * 
 * Traverses user directories for loose images, tokens, audio tracks, and tiles.
 */
export class LocalDriveAdapter extends BaseSourceAdapter {
    static get id() {
        return "local";
    }

    static get label() {
        return "Local Drive & Files";
    }

    static get icon() {
        return "fa-solid fa-hard-drive";
    }

    static get isAvailable() {
        return true;
    }

    static get supportedTypes() {
        return ["scene", "actor", "audio", "tile"];
    }

    /**
     * Traverses local directories for asset files
     */
    static async fetchCatalog(contentType = "all", filters = {}) {
        const rootPaths = ["assets", "worlds/" + game.world.id];
        const results = [];

        // Extensions to match based on content type
        const audioExts = [".mp3", ".ogg", ".wav", ".webm", ".flac", ".m4a"];
        const imageExts = [".webp", ".png", ".jpg", ".jpeg", ".svg", ".webm"];

        for (const basePath of rootPaths) {
            try {
                const target = await FilePicker.browse("data", basePath);
                for (const file of target.files || []) {
                    const fileLower = file.toLowerCase();
                    const ext = fileLower.substring(fileLower.lastIndexOf("."));
                    const fileName = decodeURIComponent(file.split("/").pop().replace(/\.[^/.]+$/, ""));

                    let isAudio = audioExts.includes(ext);
                    let isImage = imageExts.includes(ext);

                    if (contentType === "audio" && !isAudio) continue;
                    if ((contentType === "actor" || contentType === "tile" || contentType === "scene") && !isImage) continue;

                    const id = generateAssetId(file, fileName);
                    results.push({
                        id: id,
                        path: file,
                        name: fileName,
                        cover_image: isImage ? file : "icons/svg/sound.svg",
                        author: "Local User",
                        type: isAudio ? "audio" : (contentType !== "all" ? contentType : "tile"),
                        source: "local",
                        isOwned: true,
                        isInstalled: true
                    });
                }
            } catch (err) {
                // Directory may not exist yet, ignore
            }
        }

        return results.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    }

    /**
     * Creates a canvas Tile, Token, or Playlist sound from a local file
     */
    static async install(item, options = {}) {
        if (!item.path) throw new Error("LocalDriveAdapter: missing file path");

        if (item.type === "audio") {
            let playlist = game.playlists.getName("Jenne Asset Manager Ambience");
            if (!playlist) {
                playlist = await Playlist.create({ name: "Jenne Asset Manager Ambience" });
            }
            return await playlist.createEmbeddedDocuments("PlaylistSound", [{
                name: item.name,
                path: item.path,
                repeat: true
            }]);
        }

        if (item.type === "scene") {
            return await Scene.create({
                name: item.name,
                background: { src: item.path }
            });
        }

        return { success: true, path: item.path };
    }
}
