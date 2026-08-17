export const ASSET_TYPES = {
  activeEffect: { label: "Active Effect", sources: ["directory", "compendium"], tags: [] },
  actors: { label: "Actors", sources: ["directory", "compendium"], tags: ["PCs", "NPCs", "Monsters", "Mounts", "Summons"] },
  adventure: { label: "Adventure", sources: ["directory", "compendium"], tags: [] },
  cards: { label: "Cards", sources: ["compendium"], tags: [] },
  documents: { label: "Documents", sources: ["directory"], tags: [] },
  images: { label: "Images", sources: ["directory"], tags: ["Backgrounds", "Handouts", "Items", "Mounts", "Monsters", "NPCs", "PCs", "Tiles", "Treasures"] },
  items: { 
    label: "Items", 
    sources: ["directory", "compendium"], 
    tags: [
      "Consumable", "Ammunition", "Potion", "Scroll",
      "Adventuring Gear", "Rod", "Staff", "Tool", "Treasure", "Wand", "Wondrous Item",
      "Amulet", "Armor", "Ring", "Shield",
      "Weapons", "Melee", "Ranged",
      "Magical", "Common", "Uncommon", "Rare", "Very Rare", "Legendary", "Artifact",
      "Craftering Material"
    ] 
  },
  journalEntry: { label: "Journal Entry", sources: ["compendium"], tags: [] },
  macro: { label: "Macro", sources: ["directory", "compendium"], tags: ["Player", "DM"] },
  playlist: { label: "Playlist", sources: ["directory", "compendium"], tags: ["Ambiance", "Battle"] },
  scene: { label: "Scene", sources: ["compendium"], tags: [] },
  scenePacks: { label: "Scene Packs", sources: ["directory"], tags: [] },
  tables: { label: "Tables", sources: ["directory", "compendium"], tags: [] }
};
