# Jenne Asset Manager

A local-first asset manager, batch importer, and asset indexing tool built for **Foundry VTT (v13 & v14)** as part of the **Jenne Suite**.

---

## 🌟 Key Features

- **Local-First Asset Scanning & Indexing**: Rapidly scans local directories, scene packs, compendiums, and game assets with robust tagging and filtering.
- **Categorized Asset Management**: Organizes and filters assets across Active Effects, Actors, Adventures, Cards, Documents, Images, Items, Journal Entries, Macros, Playlists, Scenes, Scene Packs, and Roll Tables.
- **Beneos Battlemaps Batch Importer**: Automated batch processing, parsing, and importation of legacy and modern Beneos Battlemaps packs with scene-packer integration.
- **Unique Asset Tracking & Deduplication**: Generates deterministic, unique IDs and tracks imported assets to prevent duplicate imports and maintain reference integrity across worlds.
- **Canvas Drag-and-Drop Integration**: Custom canvas drop handlers for effortless placement of indexed tiles, tokens, sounds, and scenes directly from the Asset Manager.
- **D&D Beyond Importer Local Patcher**: Built-in utility to configure and patch local endpoints for D&D Beyond imports.
- **Jenne Suite Integration**: Automatically integrates into the unified `Jenne Suite` left sidebar controls group for seamless access alongside other Jenne tools.

---

## 📁 Repository Structure

```text
jenne-asset-manager/
├── css/
│   └── asset-manager.css          # Application styles & responsive UI
├── icons/                         # UI and tool icons
├── scripts/
│   ├── app/
│   │   ├── asset-manager-app.mjs  # Core Asset Manager ApplicationV2 window
│   │   ├── beneos-batch-importer.mjs # Beneos batch import UI
│   │   └── ddb-patch-app.mjs      # DDB Importer patch utility
│   ├── canvas-drop.mjs            # Canvas drag-and-drop event handlers
│   ├── config.mjs                 # Asset types, source paths, and tag definitions
│   ├── id-generator.mjs           # Deterministic unique ID generator
│   ├── importer.mjs               # Core document and file import engine
│   ├── init.mjs                   # Module entry point, hooks, and sidebar tools
│   ├── legacy-beneos-parser.mjs   # Parser for legacy Beneos metadata & maps
│   ├── scanner.mjs                # Local filesystem and compendium scanner
│   └── tracker.mjs                # Asset import history & deduplication registry
├── templates/                     # Handlebars UI templates
├── module.json                    # Foundry VTT module manifest
└── README.md                      # Documentation
```

---

## 🧩 Dependencies & Relationships

### Required
- **`jenne-suite`**: Core interface toolbar and suite coordination
- **`scene-packer`**: Scene and compendium packing/unpacking
- **`monks-active-tiles`**: Interactive tile triggers and scene automation

### Optional / Recommended
- **`beneos-module`**: Required when using the Beneos Batch Importer
- **`moulinette`**: Enhanced media handling and compendium indexing

---

## ⚙️ Installation

### Manual Installation
1. Clone or extract this repository into your Foundry VTT user data directory:
   ```bash
   cd <FoundryUserData>/Data/modules/
   git clone git@github.com:AustinTiger/jenne-asset-manager.git
   ```
2. Restart Foundry VTT.
3. Enable **Jenne Asset Manager** in your World Settings -> Manage Modules.

---

## 🚀 Usage

1. Open your Foundry VTT world as GM.
2. Select the **Jenne Suite** icon on the left scene controls toolbar.
3. Click on the **Jenne Asset Manager** tool icon to open the Asset Manager interface, or the **Beneos Batch Importer** icon for batch asset processing.
4. Add custom directories, scan folders, and drag items directly onto the canvas.

---

## 📜 License

Created for the Jenne Suite for Foundry VTT.
