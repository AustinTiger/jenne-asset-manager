import { BeneosAdapter } from "./beneos-adapter.mjs";
import { DdbAdapter } from "./ddb-adapter.mjs";
import { LocalDriveAdapter } from "./local-adapter.mjs";

/**
 * Universal Content Source Router & Registry
 * 
 * Aggregates all registered source adapters and routes queries, installs, and uninstalls.
 */
export class SourceRouter {
    static adapters = new Map([
        [BeneosAdapter.id, BeneosAdapter],
        [DdbAdapter.id, DdbAdapter],
        [LocalDriveAdapter.id, LocalDriveAdapter]
    ]);

    /**
     * Registers a custom source adapter plugin
     */
    static registerAdapter(adapterClass) {
        if (!adapterClass.id) throw new Error("Adapter must provide a static id");
        this.adapters.set(adapterClass.id, adapterClass);
    }

    /**
     * Returns all registered adapters that are currently available in the active Foundry world
     */
    static getAvailableAdapters() {
        return Array.from(this.adapters.values()).filter(a => a.isAvailable);
    }

    /**
     * Retrieves an adapter by its unique source ID
     */
    static getAdapter(sourceId) {
        return this.adapters.get(sourceId) || null;
    }

    /**
     * Queries assets across all active sources (or a specific source)
     * @param {string} sourceId - "all" or specific source ID ("beneos", "ddb", "local")
     * @param {string} contentType - "all", "scene", "actor", "spell", "item", "audio", "tile"
     * @param {object} filters - Additional query filters
     */
    static async searchAll({ sourceId = "all", contentType = "all", filters = {} } = {}) {
        let activeAdapters = [];
        if (sourceId && sourceId !== "all") {
            const specific = this.getAdapter(sourceId);
            if (specific && specific.isAvailable) activeAdapters = [specific];
        } else {
            activeAdapters = this.getAvailableAdapters();
        }

        const promises = activeAdapters.map(adapter => {
            return adapter.fetchCatalog(contentType, filters).catch(err => {
                console.warn(`SourceRouter | Query failed for adapter ${adapter.id}:`, err);
                return [];
            });
        });

        const resultsArrays = await Promise.all(promises);
        const combined = resultsArrays.flat();

        // Apply text search filtering if provided
        if (filters.search) {
            const searchLower = filters.search.toLowerCase();
            return combined.filter(item => (item.name || "").toLowerCase().includes(searchLower));
        }

        return combined;
    }

    /**
     * Routes an install request to the responsible source adapter
     */
    static async install(item, options = {}) {
        const sourceId = item.source || options.source;
        const adapter = this.getAdapter(sourceId);
        if (!adapter) throw new Error(`No adapter found for source: ${sourceId}`);
        return await adapter.install(item, options);
    }

    /**
     * Routes an uninstall request to the responsible source adapter
     */
    static async uninstall(item, options = {}) {
        const sourceId = item.source || options.source;
        const adapter = this.getAdapter(sourceId);
        if (!adapter) throw new Error(`No adapter found for source: ${sourceId}`);
        return await adapter.uninstall(item, options);
    }
}
