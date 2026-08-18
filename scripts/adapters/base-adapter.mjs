/**
 * Base Source Adapter Interface for Jenne Asset Manager
 * 
 * Defines the contract that all content provider drivers (Beneos, DDB, Local Drive, Compendiums) must implement.
 */
export class BaseSourceAdapter {
    /**
     * Unique identifier for this source adapter (e.g. "beneos", "ddb", "local", "compendium")
     * @returns {string}
     */
    static get id() {
        throw new Error("Adapter must implement static get id");
    }

    /**
     * User-facing label for this source
     * @returns {string}
     */
    static get label() {
        throw new Error("Adapter must implement static get label");
    }

    /**
     * FontAwesome icon class for this source
     * @returns {string}
     */
    static get icon() {
        return "fa-solid fa-folder";
    }

    /**
     * Checks whether the underlying provider module or service is currently available in Foundry.
     * @returns {boolean}
     */
    static get isAvailable() {
        return false;
    }

    /**
     * Array of content types supported by this adapter (e.g. ["scene", "actor", "item", "spell", "audio", "tile"])
     * @returns {string[]}
     */
    static get supportedTypes() {
        return [];
    }

    /**
     * Fetches the catalog of available assets for a given content type.
     * @param {string} contentType - The type of content to query
     * @param {object} [filters={}] - Optional query filters (search, biomes, CR, school, etc.)
     * @returns {Promise<Array<object>>} - Array of normalized asset descriptors
     */
    static async fetchCatalog(contentType, filters = {}) {
        return [];
    }

    /**
     * Installs or imports an item into Foundry.
     * @param {object} item - The asset descriptor to install
     * @param {object} [options={}] - Installation options (resolution, targetPack, sceneSlugs, etc.)
     * @returns {Promise<object>} - Result status
     */
    static async install(item, options = {}) {
        throw new Error("Adapter must implement install()");
    }

    /**
     * Uninstalls or removes an item from Foundry.
     * @param {object} item - The asset descriptor to uninstall
     * @param {object} [options={}] - Uninstallation options
     * @returns {Promise<object>} - Result status
     */
    static async uninstall(item, options = {}) {
        throw new Error("Adapter must implement uninstall()");
    }

    /**
     * Checks the local installation / download status of an asset.
     * @param {object|string} item - The asset descriptor or ID
     * @returns {Promise<{isDownloaded: boolean, isInstalled: boolean, isPartial: boolean}>}
     */
    static async checkStatus(item) {
        return { isDownloaded: false, isInstalled: false, isPartial: false };
    }
}
