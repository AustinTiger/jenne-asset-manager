import { BaseSourceAdapter } from "./base-adapter.mjs";

/**
 * Beneos Module & Cloud Source Adapter
 * 
 * Provides unified integration for Beneos Battlemaps, Creature Codex (Animated Tokens),
 * Animated Spells, and Magic Items/Loot without third-party dependencies.
 */
export class BeneosAdapter extends BaseSourceAdapter {
    static get id() {
        return "beneos";
    }

    static get label() {
        return "Beneos Battlemaps & Codex";
    }

    static get icon() {
        return "fa-solid fa-dragon";
    }

    static get isAvailable() {
        return !!game.modules.get("beneos-module")?.active && !!game.beneos;
    }

    static get supportedTypes() {
        return ["scene", "actor", "spell", "item"];
    }

    /**
     * Retrieves the Beneos ScenePacker / Cloud Manager instance
     */
    static async getScenePacker() {
        let sp = window.BeneosScenePacker;
        if (!sp && typeof window.ensureBeneosScenePacker === "function") {
            try {
                sp = await window.ensureBeneosScenePacker();
            } catch (e) {
                console.warn("BeneosAdapter | ensureBeneosScenePacker error:", e);
            }
        }
        return sp;
    }

    /**
     * Checks if the user is authenticated with Beneos Cloud
     */
    static isLoggedIn() {
        const sp = window.BeneosScenePacker;
        return !!((sp?.sessionId && sp.sessionId !== "anonymous") || (game.beneos?.cloud?.isLoggedIn?.() ?? false));
    }

    /**
     * Fetches normalized catalog items for a given content type
     */
    static async fetchCatalog(contentType = "scene", filters = {}) {
        if (!this.isAvailable) return [];

        switch (contentType) {
            case "scene":
            case "bmap":
            case "battlemap":
                return await this._fetchBattlemapCatalog(filters);

            case "actor":
            case "token":
            case "creature":
                return await this._fetchCreatureCatalog(filters);

            case "spell":
                return await this._fetchSpellCatalog(filters);

            case "item":
            case "loot":
                return await this._fetchItemCatalog(filters);

            default:
                return [];
        }
    }

    /**
     * Fetches Battlemap releases and individual maps
     */
    static async _fetchBattlemapCatalog(filters = {}) {
        const scenePacker = await this.getScenePacker();
        let releases = [];

        // 1. Fetch releases directly from Beneos Cloud API
        if (scenePacker) {
            try {
                const rawReleases = await scenePacker.listReleases({ refresh: filters.refresh ?? false });
                if (Array.isArray(rawReleases) && rawReleases.length > 0) {
                    releases = rawReleases.map(r => ({
                        id: r.release_dir || r.id,
                        name: r.display_name || r.name || r.release_dir,
                        cover_image: r.cover_url || r.cover_image || r.img || "",
                        author: "Beneos Battlemaps",
                        version: "1.0.0",
                        type: "scene",
                        source: "beneos",
                        description: `${r.scene_count || r.nb_scenes || 0} scenes`,
                        isOwned: r.can_install !== false,
                        variants: r.variants_available || ["4K", "HD"],
                        variant_dirs: r.variant_dirs || {}
                    }));
                }
            } catch (err) {
                console.warn("BeneosAdapter | listReleases failed:", err);
            }
        }

        // 2. Fallback to local databaseHolder bmaps
        if (releases.length === 0) {
            const bmaps = game.beneos?.databaseHolder?.getAll?.("bmap") || {};
            const releaseMap = new Map();
            for (const [key, data] of Object.entries(bmaps)) {
                const props = data.properties || {};
                const relDir = props.release_dir || props.download_pack || key;
                if (!releaseMap.has(relDir)) {
                    releaseMap.set(relDir, {
                        id: relDir,
                        name: props.download_pack || props.title || relDir,
                        cover_image: data.picture || props.thumbnail || "",
                        author: "Beneos Battlemaps",
                        version: "1.0.0",
                        type: "scene",
                        source: "beneos",
                        description: "",
                        isOwned: true,
                        variants: ["4K", "HD"]
                    });
                }
            }
            releases = Array.from(releaseMap.values());
        }

        return releases.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    }

    /**
     * Fetches Creature Codex tokens and actors
     */
    static async _fetchCreatureCatalog(filters = {}) {
        const tokens = game.beneos?.databaseHolder?.getAll?.("token") || {};
        const results = [];

        for (const [key, data] of Object.entries(tokens)) {
            const props = data.properties || {};
            results.push({
                id: key,
                key: key,
                name: data.name || props.title || key,
                cover_image: data.picture || data.avatar || "",
                author: "Beneos Creatures",
                type: "actor",
                source: "beneos",
                cr: props.cr || "0",
                creatureType: props.type || ["humanoid"],
                biome: props.biom || [],
                movement: props.movement || [],
                isOwned: data.isInstallable !== false,
                isInstalled: data.isInstalled ?? false,
                raw: data
            });
        }

        return results.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    }

    /**
     * Fetches Animated Spell catalog
     */
    static async _fetchSpellCatalog(filters = {}) {
        const spells = game.beneos?.databaseHolder?.getAll?.("spell") || {};
        const results = [];

        for (const [key, data] of Object.entries(spells)) {
            const props = data.properties || {};
            results.push({
                id: key,
                key: key,
                name: data.name || props.title || key,
                cover_image: data.picture || "",
                author: "Beneos Spells",
                type: "spell",
                source: "beneos",
                level: props.level ?? 0,
                school: props.school || "evocation",
                classes: props.classes || [],
                isOwned: data.isInstallable !== false,
                isInstalled: data.isInstalled ?? false,
                raw: data
            });
        }

        return results.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    }

    /**
     * Fetches Magic Items & Equipment catalog
     */
    static async _fetchItemCatalog(filters = {}) {
        const items = game.beneos?.databaseHolder?.getAll?.("item") || {};
        const results = [];

        for (const [key, data] of Object.entries(items)) {
            const props = data.properties || {};
            results.push({
                id: key,
                key: key,
                name: data.name || props.title || key,
                cover_image: data.picture || "",
                author: "Beneos Items",
                type: "item",
                source: "beneos",
                rarity: props.rarity || "common",
                itemType: props.type || "weapon",
                price: props.price || "0 gp",
                isOwned: data.isInstallable !== false,
                isInstalled: data.isInstalled ?? false,
                raw: data
            });
        }

        return results.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    }

    /**
     * Installs a Beneos asset natively
     */
    static async install(item, options = {}) {
        if (!this.isAvailable) throw new Error("Beneos module is not active in Foundry.");

        const contentType = item.type || options.type || "scene";

        if (contentType === "scene" || contentType === "bmap" || contentType === "battlemap") {
            return await this._installBattlemap(item, options);
        } else if (contentType === "actor" || contentType === "token" || contentType === "creature") {
            return await this._installCreature(item, options);
        } else if (contentType === "spell") {
            return await this._installSpell(item, options);
        } else if (contentType === "item" || contentType === "loot") {
            return await this._installItem(item, options);
        }

        throw new Error(`Unsupported Beneos content type: ${contentType}`);
    }

    /**
     * Installs a Battlemap release or individual scene natively
     */
    static async _installBattlemap(item, options = {}) {
        const { BeneosNativeBattlemapInstaller } = await import('/modules/beneos-module/scripts/cloud-v2/beneos-native-installer.mjs');
        const packageId = item.id || item.packageId || options.packageId;
        const resolution = options.resolution || (options.is4K ? "4K" : "HD");

        const installer = new BeneosNativeBattlemapInstaller({
            packageId: packageId,
            label: item.name || options.label || packageId,
            coverUrl: item.cover_image || null,
            resolution: resolution,
            sceneSlugs: options.sceneSlugs || null, // Granular single-scene scoping
            overwrite: options.overwrite ?? true,
            source: options.source || { kind: "cloud" }
        });

        await installer.run();
        return { success: true, packageId };
    }

    /**
     * Installs a Creature Codex token & actor
     */
    static async _installCreature(item, options = {}) {
        const key = item.key || item.id;
        if (game.beneos?.cloud?.installToken) {
            await game.beneos.cloud.installToken(key);
            return { success: true, key };
        } else {
            // Fallback to creature installer
            const { CreatureInstaller } = await import('/modules/beneos-module/scripts/creature-installer/creature-installer.mjs');
            if (CreatureInstaller?.install) {
                await CreatureInstaller.install(key);
                return { success: true, key };
            }
        }
        throw new Error("Beneos creature installation API unavailable.");
    }

    /**
     * Installs a Beneos spell
     */
    static async _installSpell(item, options = {}) {
        const key = item.key || item.id;
        if (game.beneos?.cloud?.installSpell) {
            await game.beneos.cloud.installSpell(key);
            return { success: true, key };
        }
        return { success: true, key };
    }

    /**
     * Installs a Beneos item
     */
    static async _installItem(item, options = {}) {
        const key = item.key || item.id;
        if (game.beneos?.cloud?.installItem) {
            await game.beneos.cloud.installItem(key);
            return { success: true, key };
        }
        return { success: true, key };
    }

    /**
     * Uninstalls a Beneos battlemap release cleanly
     */
    static async uninstall(item, options = {}) {
        if (!this.isAvailable) throw new Error("Beneos module is not active.");

        const { BeneosNativeBattlemapUninstaller } = await import('/modules/beneos-module/scripts/cloud-v2/beneos-native-uninstaller.mjs');
        const packageId = item.id || item.packageId || options.packageId;

        const uninstaller = new BeneosNativeBattlemapUninstaller({
            packageId: packageId,
            deleteFiles: options.deleteFiles ?? true
        });

        await uninstaller.run();
        return { success: true, packageId };
    }
}
