import { BaseSourceAdapter } from "./base-adapter.mjs";

/**
 * D&D Beyond Importer Source Adapter
 * 
 * Bridges parsed monsters, spells, items, and compendiums from the ddb-importer module.
 */
export class DdbAdapter extends BaseSourceAdapter {
    static get id() {
        return "ddb";
    }

    static get label() {
        return "D&D Beyond Importer";
    }

    static get icon() {
        return "fa-solid fa-dice-d20";
    }

    static get isAvailable() {
        return !!game.modules.get("ddb-importer")?.active;
    }

    static get supportedTypes() {
        return ["actor", "spell", "item", "scene"];
    }

    /**
     * Fetches catalog documents indexed from DDB compendiums
     */
    static async fetchCatalog(contentType = "actor", filters = {}) {
        if (!this.isAvailable) return [];

        const results = [];
        const packs = game.packs.filter(p => p.metadata.packageName === "ddb-importer" || p.metadata.id.startsWith("world.ddb-") || p.metadata.id.includes("ddb"));

        for (const pack of packs) {
            const documentType = pack.metadata.type; // "Actor", "Item", "Scene", "JournalEntry"
            
            // Map request contentType to pack documentType
            let matchesType = false;
            if ((contentType === "actor" || contentType === "monster") && documentType === "Actor") matchesType = true;
            if ((contentType === "item" || contentType === "spell") && documentType === "Item") matchesType = true;
            if (contentType === "scene" && documentType === "Scene") matchesType = true;

            if (!matchesType) continue;

            const index = await pack.getIndex({ fields: ["img", "system.details.cr", "system.level", "system.school", "system.rarity"] });
            for (const entry of index) {
                // Filter out non-spells if requesting spells specifically
                if (contentType === "spell" && entry.type !== "spell") continue;
                if (contentType === "item" && entry.type === "spell") continue;

                results.push({
                    id: entry._id,
                    uuid: entry.uuid,
                    name: entry.name,
                    cover_image: entry.img || "icons/svg/mystery-man.svg",
                    packId: pack.metadata.id,
                    packTitle: pack.metadata.label,
                    author: "D&D Beyond",
                    type: contentType,
                    source: "ddb",
                    cr: entry.system?.details?.cr || null,
                    level: entry.system?.level ?? null,
                    school: entry.system?.school || null,
                    rarity: entry.system?.rarity || null,
                    isOwned: true,
                    isInstalled: true
                });
            }
        }

        return results.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    }

    /**
     * Imports an entry from a DDB compendium into the active world
     */
    static async install(item, options = {}) {
        if (!item.uuid) throw new Error("DdbAdapter: missing document UUID");
        const doc = await fromUuid(item.uuid);
        if (!doc) throw new Error(`Document not found for UUID: ${item.uuid}`);

        const collection = game.collections.get(doc.documentName);
        if (collection) {
            return await collection.importFromCompendium(doc.pack, doc.id);
        }
        return doc;
    }

    /**
     * Deletes an imported DDB document from the world
     */
    static async uninstall(item, options = {}) {
        if (!item.id) return;
        const collection = game.collections.get(item.type === "actor" ? "actors" : (item.type === "item" ? "items" : "scenes"));
        const doc = collection?.get(item.id);
        if (doc) {
            return await doc.delete();
        }
    }
}
