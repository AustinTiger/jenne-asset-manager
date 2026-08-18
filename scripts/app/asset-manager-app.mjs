import { LocalScanner } from "../scanner.mjs";
import { ImportTracker } from "../tracker.mjs";
import { batchImport } from "../importer.mjs";
import { JenneSettingsApp } from "./settings-app.mjs";
import { ASSET_TYPES } from "../config.mjs";
import { SourceRouter } from "../adapters/source-router.mjs";
import { BeneosAdapter } from "../adapters/beneos-adapter.mjs";
import { DdbAdapter } from "../adapters/ddb-adapter.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class JenneAssetManagerApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options = {}) {
    super(options);
    this._catalog = null;
    this._isScanning = false;
    this._selectedAssets = new Set();
    this._searchQuery = "";
    this._activeSource = "all";   // Content source filter ("all", "beneos", "ddb", "local")
    this._activeTab = "actors"; // Default start tab
    this._activeTags = new Set(); // Active tag filters
    this._targetPackId = "";      // Persistent target compendium ID
    this._subfolder = "";         // Persistent subfolder input value
    this._assetsPerRow = 6;       // Default columns per row
    this._previewAsset = null;    // Asset currently showing in preview popup
    this._audioVolume = 0.5;      // Audio playback volume
    this._activeAudio = null;     // Active playing audio node
    this._lastSelectedId = null;  // Tracking last clicked ID for shift-click selection
  }

  static DEFAULT_OPTIONS = {
    id: "jenne-asset-manager-app",
    classes: ["jenne-asset-manager"],
    tag: "div",
    window: {
      title: "Jenne Asset Manager",
      icon: "fas fa-folder-open",
      resizable: true,
      minimizable: true
    },
    position: {
      width: 1100,
      height: 750
    },
    actions: {
      selectTab: JenneAssetManagerApp._onSelectTab,
      scan: JenneAssetManagerApp._onScan,
      toggleSelect: JenneAssetManagerApp._onToggleSelect,
      toggleSelectAll: JenneAssetManagerApp._onToggleSelectAll,
      openDocument: JenneAssetManagerApp._onOpenDocument,
      triggerImport: JenneAssetManagerApp._onTriggerImport,
      openSettings: JenneAssetManagerApp._onOpenSettings,
      openPreview: JenneAssetManagerApp._onOpenPreview,
      closePreview: JenneAssetManagerApp._onClosePreview,
      playAudio: JenneAssetManagerApp._onPlayAudio,
      stopAudio: JenneAssetManagerApp._onStopAudio,
      openBeneosImporter: JenneAssetManagerApp._onOpenBeneosImporter
    }
  };

  static PARTS = {
    main: {
      template: "modules/jenne-asset-manager/templates/asset-manager.hbs"
    }
  };

  /** @override */
  async _prepareContext(options) {
    const tab = this._activeTab;

    const typeDocMap = {
      activeEffect: "ActiveEffect",
      actors: "Actor",
      adventure: "Adventure",
      cards: "Cards",
      items: "Item",
      journalEntry: "JournalEntry",
      macro: "Macro",
      playlist: "Playlist",
      scene: "Scene",
      tables: "RollTable"
    };

    // List of GMs compendiums for drop-down target selection (dynamically filtered by tab type)
    const compendiums = game.packs
      .filter((p) => {
        if (p.metadata.locked) return false;
        
        // Dynamic filtering based on tab type
        const targetDocType = typeDocMap[tab];
        if (targetDocType) {
          return p.metadata.type === targetDocType;
        }
        return true; // mixed tab includes all compendiums
      })
      .map((p) => ({
        id: p.metadata.id,
        label: `${p.metadata.label} [${p.metadata.type}]`,
        type: p.metadata.type,
        selected: p.metadata.id === this._targetPackId
      }));

    if (!this._catalog) {
      return {
        assets: [],
        compendiums: compendiums,
        subfolder: this._subfolder,
        activeTab: this._activeTab,
        searchQuery: this._searchQuery,
        anySelected: false,
        selectedCount: 0,
        assetsPerRow: this._assetsPerRow,
        isScanning: true,
        previewAsset: null
      };
    }

    // Build the tabs list from ASSET_TYPES config dynamically
    const tabs = Object.entries(ASSET_TYPES).map(([key, config]) => {
      let icon = "fa-file";
      if (key === "activeEffect") icon = "fa-bolt";
      else if (key === "actors") icon = "fa-user-circle";
      else if (key === "adventure") icon = "fa-compass";
      else if (key === "cards") icon = "fa-id-card";
      else if (key === "documents") icon = "fa-file-alt";
      else if (key === "images") icon = "fa-image";
      else if (key === "items") icon = "fa-suitcase";
      else if (key === "journalEntry") icon = "fa-book-open";
      else if (key === "macro") icon = "fa-terminal";
      else if (key === "playlist") icon = "fa-volume-up";
      else if (key === "scene") icon = "fa-map";
      else if (key === "scenePacks") icon = "fa-archive";
      else if (key === "tables") icon = "fa-table";

      return {
        name: key,
        label: config.label,
        icon: icon,
        active: this._activeTab === key
      };
    });
    // Add mixed/All tab
    tabs.push({
      name: "mixed",
      label: "All",
      icon: "fa-asterisk",
      active: this._activeTab === "mixed"
    });

    // Build tags list for filter bar
    const allowedTagsForTab = ASSET_TYPES[this._activeTab]?.tags || [];
    const tagsList = allowedTagsForTab.map(tagName => ({
      name: tagName,
      checked: this._activeTags.has(tagName)
    }));

    // Collect all assets from all publishers and packs for global search
    const allAssets = [];
    for (const publisher of this._catalog.publishers) {
      for (const pack of publisher.packs) {
        for (const asset of pack.assets) {
          allAssets.push({
            ...asset,
            publisherName: publisher.name,
            packName: pack.name,
            packType: pack.type,
            isBeneosLegacy: pack.isBeneosLegacy
          });
        }
      }
    }

    // Filter assets by tab category, active tags, and search query
    const filteredAssets = allAssets.filter((asset) => {
      // 1. Tab category filter
      const matchesTab = (tab === "mixed") || (asset.packType === tab);
      if (!matchesTab) return false;

      // 2. Active tags filter
      if (this._activeTags.size > 0) {
        const hasTag = (asset.tags || []).some(t => this._activeTags.has(t));
        if (!hasTag) return false;
      }

      // 3. Search query filter (matches filename or pack name)
      const queryMatches = 
        asset.filename.toLowerCase().includes(this._searchQuery.toLowerCase()) ||
        asset.packName.toLowerCase().includes(this._searchQuery.toLowerCase()) ||
        asset.publisherName.toLowerCase().includes(this._searchQuery.toLowerCase());

      return queryMatches;
    });

    // Attach selected state to rendering context
    const assetsWithSelection = filteredAssets.map((asset) => ({
      ...asset,
      selected: this._selectedAssets.has(asset.id),
      iconClass: asset.type === "audio" ? "fa-music" : asset.type === "video" ? "fa-video" : "fa-image"
    }));

    // Setup select options for grid sizing (columns per row)
    const columnOptions = [
      { value: 3, label: "3 per row", selected: this._assetsPerRow === 3 },
      { value: 4, label: "4 per row", selected: this._assetsPerRow === 4 },
      { value: 5, label: "5 per row", selected: this._assetsPerRow === 5 },
      { value: 6, label: "6 per row", selected: this._assetsPerRow === 6 },
      { value: 8, label: "8 per row", selected: this._assetsPerRow === 8 },
      { value: 10, label: "10 per row", selected: this._assetsPerRow === 10 }
    ];

    return {
      assets: assetsWithSelection,
      compendiums: compendiums,
      subfolder: this._subfolder,
      activeTab: this._activeTab,
      activeSource: this._activeSource || "all",
      hasBeneos: BeneosAdapter.isAvailable,
      hasDdb: DdbAdapter.isAvailable,
      tabs: tabs,
      tagsList: tagsList,
      searchQuery: this._searchQuery,
      anySelected: this._selectedAssets.size > 0,
      selectedCount: this._selectedAssets.size,
      assetsPerRow: this._assetsPerRow,
      columnOptions: columnOptions,
      isScanning: false,
      previewAsset: this._previewAsset
    };
  }

  /** @override */
  _onRender(context, options) {
    super._onRender(context, options);
    
    if (!this._catalog && !this._isScanning) {
      this._isScanning = true;
      this._performScan().then(() => {
        this._isScanning = false;
        this.render({ force: true });
      }).catch((err) => {
        console.error("Jenne Asset Manager | Scanning failed:", err);
        this._isScanning = false;
        this.render({ force: true });
      });
    }
  }

  /** @override */
  _replaceHTML(result, content, options) {
    super._replaceHTML(result, content, options);
    
    // Bind search bar input events manually
    const searchBar = content.querySelector(".jenne-search-input");
    if (searchBar) {
      searchBar.value = this._searchQuery;
      searchBar.focus(); // Keep focus while typing
      searchBar.addEventListener("input", (ev) => {
        this._searchQuery = ev.target.value;
        this.render({ parts: ["main"] });
      });
    }

    // Bind audio volume slider in the preview modal
    const volumeSlider = content.querySelector(".volume-slider");
    if (volumeSlider) {
      volumeSlider.value = this._audioVolume;
      volumeSlider.addEventListener("input", (ev) => {
        const vol = parseFloat(ev.target.value);
        this._audioVolume = vol;
        if (this._activeAudio) {
          this._activeAudio.volume = vol;
        }
      });
    }

    // Bind target compendium dropdown silently
    const compTarget = content.querySelector("#compendium-target");
    if (compTarget) {
      compTarget.value = this._targetPackId;
      compTarget.addEventListener("change", (ev) => {
        this._targetPackId = ev.target.value;
      });
    }

    // Bind subfolder input silently
    const folderTarget = content.querySelector("#folder-target");
    if (folderTarget) {
      folderTarget.value = this._subfolder;
      folderTarget.addEventListener("change", (ev) => {
        this._subfolder = ev.target.value.trim();
      });
    }

    // Bind source picker select
    const sourcePicker = content.querySelector("#source-picker");
    if (sourcePicker) {
      sourcePicker.value = this._activeSource || "all";
      sourcePicker.addEventListener("change", (ev) => {
        this._activeSource = ev.target.value;
        this.render({ parts: ["main"] });
      });
    }

    // Bind column picker select
    const colPicker = content.querySelector("#column-picker");
    if (colPicker) {
      colPicker.addEventListener("change", (ev) => {
        this._assetsPerRow = parseInt(ev.target.value);
        this.render({ parts: ["main"] });
      });
    }

    // Bind tag filter checkboxes
    content.querySelectorAll(".jenne-tag-checkbox").forEach(cb => {
      cb.addEventListener("change", (ev) => {
        const tagName = cb.dataset.tagName;
        if (ev.target.checked) {
          this._activeTags.add(tagName);
        } else {
          this._activeTags.delete(tagName);
        }
        this.render({ parts: ["main"] });
      });
    });

    // Add drag handlers for canvas drag-and-drop
    content.querySelectorAll(".jenne-asset-card.draggable").forEach((card) => {
      card.addEventListener("dragstart", (ev) => {
        const isCompendium = card.dataset.isCompendium === "true";
        if (isCompendium) {
          const dragData = {
            type: card.dataset.documentName, // e.g. "Actor", "Scene", "Item"
            uuid: card.dataset.uuid
          };
          ev.dataTransfer.setData("text/plain", JSON.stringify(dragData));
        } else {
          const dragData = {
            type: "JenneAsset",
            assetId: card.dataset.assetId,
            relativePath: card.dataset.relativePath,
            filename: card.dataset.filename,
            assetType: card.dataset.assetType
          };
          ev.dataTransfer.setData("text/plain", JSON.stringify(dragData));
        }
      });
    });

    // Add double-click handlers for opening lightbox preview
    content.querySelectorAll(".jenne-asset-card").forEach((card) => {
      card.addEventListener("dblclick", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const id = card.dataset.assetId;
        this._openPreviewById(id);
      });
    });
  }

  /** @override */
  _onClose(options) {
    // Stop any active playing preview audio when manager window is closed
    if (this._activeAudio) {
      this._activeAudio.pause();
      this._activeAudio = null;
    }
    return super._onClose(options);
  }

  async _performScan() {
    this._catalog = await LocalScanner.scanAll();
    await ImportTracker.updateImportStatus(this._catalog);
  }

  _openPreviewById(id) {
    let found = null;
    if (this._catalog) {
      for (const publisher of this._catalog.publishers) {
        for (const pack of publisher.packs) {
          found = pack.assets.find(a => a.id === id);
          if (found) break;
        }
        if (found) break;
      }
    }

    if (found) {
      this._previewAsset = found;
      this.render();
    }
  }

  // --- Actions ---

  static _onSelectTab(event, target) {
    this._activeTab = target.dataset.tabName;
    this._selectedAssets.clear();
    this._activeTags.clear(); // Clear tag filters when tab changes
    this.render();
  }

  static async _onScan(event, target) {
    this._selectedAssets.clear();
    this._catalog = null;
    ui.notifications.info("Scanning catalog sources...");
    this.render();
  }

  static _onToggleSelect(event, target) {
    // If the click was on the preview button or its children, do not toggle selection!
    const isPreviewBtn = event.target.closest(".card-preview-btn");
    if (isPreviewBtn) return;

    const id = target.dataset.assetId;
    const isShift = event.shiftKey;

    // Find currently visible asset cards in the DOM to determine the range
    const visibleCards = Array.from(this.element.querySelectorAll(".jenne-asset-card"));
    const visibleIds = visibleCards.map(c => c.dataset.assetId);

    if (isShift && this._lastSelectedId && visibleIds.includes(this._lastSelectedId) && visibleIds.includes(id)) {
      const idx1 = visibleIds.indexOf(this._lastSelectedId);
      const idx2 = visibleIds.indexOf(id);
      const start = Math.min(idx1, idx2);
      const end = Math.max(idx1, idx2);

      // Select everything in the range
      for (let i = start; i <= end; i++) {
        this._selectedAssets.add(visibleIds[i]);
      }
      this._lastSelectedId = id;
    } else {
      // Standard toggle select
      if (this._selectedAssets.has(id)) {
        this._selectedAssets.delete(id);
        this._lastSelectedId = null;
      } else {
        this._selectedAssets.add(id);
        this._lastSelectedId = id;
      }
    }
    this.render({ parts: ["main"] });
  }

  static _onToggleSelectAll(event, target) {
    const visibleCards = this.element.querySelectorAll(".jenne-asset-card");
    const allSelected = Array.from(visibleCards).every((card) => 
      this._selectedAssets.has(card.dataset.assetId)
    );

    if (allSelected) {
      visibleCards.forEach((card) => this._selectedAssets.delete(card.dataset.assetId));
    } else {
      visibleCards.forEach((card) => this._selectedAssets.add(card.dataset.assetId));
    }
    this.render({ parts: ["main"] });
  }

  static async _onOpenDocument(event, target) {
    const docUuid = target.dataset.documentUuid;
    if (!docUuid) return;
    
    const doc = await fromUuid(docUuid);
    if (doc) {
      doc.sheet.render(true);
    } else {
      ui.notifications.warn("Could not load imported document. It may have been deleted.");
    }
  }

  static async _onTriggerImport(event, target) {
    if (this._selectedAssets.size === 0) {
      ui.notifications.warn("Please select at least one asset to import.");
      return;
    }

    const packId = this._targetPackId;
    const folderName = this._subfolder || "";

    if (!packId) {
      ui.notifications.warn("Please select a target Compendium Pack.");
      return;
    }

    // Collect all selected assets across publishers
    const selectedAssetsToImport = [];
    for (const publisher of this._catalog.publishers) {
      for (const pack of publisher.packs) {
        const matching = pack.assets.filter((a) => this._selectedAssets.has(a.id));
        for (const asset of matching) {
          selectedAssetsToImport.push({
            ...asset,
            isBeneosLegacy: pack.isBeneosLegacy
          });
        }
      }
    }

    if (selectedAssetsToImport.length === 0) return;

    ui.notifications.info(`Batch importing ${selectedAssetsToImport.length} assets...`);
    
    try {
      // Pass isBeneosLegacy setting based on the first selected item's pack type
      const isBeneos = selectedAssetsToImport[0].isBeneosLegacy;
      await batchImport(selectedAssetsToImport, packId, folderName, isBeneos);
      
      this._selectedAssets.clear();
      await ImportTracker.updateImportStatus(this._catalog);
      this.render();
      ui.notifications.info("Batch import completed successfully.");
    } catch (err) {
      console.error(err);
      ui.notifications.error("Import failed. See console for details.");
    }
  }

  static _onOpenSettings(event, target) {
    new JenneSettingsApp().render({ force: true });
  }

  static _onOpenPreview(event, target) {
    const id = target.dataset.assetId;
    this._openPreviewById(id);
  }

  static _onClosePreview(event, target) {
    if (this._activeAudio) {
      this._activeAudio.pause();
      this._activeAudio = null;
    }
    this._previewAsset = null;
    this.render();
  }

  static _onPlayAudio(event, target) {
    const path = target.dataset.path;
    if (this._activeAudio) {
      this._activeAudio.pause();
    }
    
    this._activeAudio = new Audio(path);
    this._activeAudio.volume = this._audioVolume;
    this._activeAudio.play().catch(err => {
      console.error("Audio playback failed:", err);
      ui.notifications.error("Failed to play preview sound.");
    });
  }

  static _onStopAudio(event, target) {
    if (this._activeAudio) {
      this._activeAudio.pause();
      this._activeAudio.currentTime = 0;
    }
  }

  static async _onOpenBeneosImporter(event, target) {
    if (!game.modules.get("beneos-module")?.active) {
      return ui.notifications.warn("The 'beneos-module' must be active to open the Beneos Batch Importer.");
    }
    const { BeneosBatchImporterApp } = await import("./beneos-batch-importer.mjs");
    new BeneosBatchImporterApp().render({ force: true });
  }
}
