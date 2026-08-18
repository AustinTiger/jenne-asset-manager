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
    this._sortBy = "name-asc";    // Default sort order ("name-asc", "name-desc", "cr-asc", "cr-desc", "status-installed", "status-updates")
    this._statusFilter = "all";   // Status filter ("all", "installed", "cloud", "update", "new", "locked")
    this._selectedBatchAction = "import-compendium"; // Default batch action
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
      triggerBatchAction: JenneAssetManagerApp._onTriggerBatchAction,
      openSettings: JenneAssetManagerApp._onOpenSettings,
      openPreview: JenneAssetManagerApp._onOpenPreview,
      closePreview: JenneAssetManagerApp._onClosePreview,
      playAudio: JenneAssetManagerApp._onPlayAudio,
      stopAudio: JenneAssetManagerApp._onStopAudio,
      openBeneosImporter: JenneAssetManagerApp._onOpenBeneosImporter,
      installBeneosActor: JenneAssetManagerApp._onInstallBeneosActor,
      openBeneosActor: JenneAssetManagerApp._onOpenBeneosActor
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

    // Collect all assets from local publishers and external adapters
    const allAssets = [];

    // 1. Local drive assets
    if (this._activeSource === "all" || this._activeSource === "local") {
      for (const publisher of (this._catalog?.publishers || [])) {
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
    }

    // 2. Beneos module assets (when on actors or mixed tab)
    if (this._activeSource === "all" || this._activeSource === "beneos") {
      if (BeneosAdapter.isAvailable && (tab === "actors" || tab === "mixed")) {
        const beneosActors = await BeneosAdapter.fetchCatalog("actor");
        allAssets.push(...beneosActors);
      }
    }

    // Filter assets by tab category, active tags, and search query
    const filteredAssets = allAssets.filter((asset) => {
      // 1. Tab category filter
      const matchesTab = (tab === "mixed") || (asset.packType === tab) || (tab === "actors" && asset.type === "actor");
      if (!matchesTab) return false;

      // 2. Active tags filter
      if (this._activeTags.size > 0) {
        const hasTag = (asset.tags || []).some(t => this._activeTags.has(t)) ||
                       (asset.biome && this._activeTags.has(asset.biome)) ||
                       (asset.creatureType && this._activeTags.has(asset.creatureType));
        if (!hasTag) return false;
      }

      // 3. Status filter (installed, cloud/uninstalled, update, new, locked)
      if (this._statusFilter !== "all") {
        const isInst = !!asset.isInstalled || !!asset.imported;
        if (this._statusFilter === "installed") {
          if (!isInst) return false;
        } else if (this._statusFilter === "cloud" || this._statusFilter === "not-installed") {
          if (isInst || asset.isOwned === false) return false;
        } else if (this._statusFilter === "update") {
          if (!asset.isUpdate) return false;
        } else if (this._statusFilter === "new") {
          if (!asset.isNew) return false;
        } else if (this._statusFilter === "locked") {
          if (asset.isOwned !== false) return false;
        }
      }

      // 4. Search query filter (matches name, creature type, biome, pack name)
      const q = this._searchQuery.toLowerCase();
      const queryMatches = 
        (asset.filename || "").toLowerCase().includes(q) ||
        (asset.name || "").toLowerCase().includes(q) ||
        (asset.creatureType || "").toLowerCase().includes(q) ||
        (asset.biome || "").toLowerCase().includes(q) ||
        (asset.packName || "").toLowerCase().includes(q) ||
        (asset.publisherName || "").toLowerCase().includes(q);

      return queryMatches;
    });

    // Helper to parse fractional and numeric challenge ratings
    const parseCrValue = (cr) => {
      if (cr === undefined || cr === null || cr === "") return -1;
      const str = String(cr).trim();
      if (str.includes("/")) {
        const [num, den] = str.split("/").map(Number);
        if (den) return num / den;
      }
      const val = parseFloat(str);
      return isNaN(val) ? -1 : val;
    };

    // Sort filtered assets according to _sortBy
    filteredAssets.sort((a, b) => {
      const nameA = a.name || a.filename || "";
      const nameB = b.name || b.filename || "";

      if (this._sortBy === "name-asc") {
        return nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: "base" });
      } else if (this._sortBy === "name-desc") {
        return nameB.localeCompare(nameA, undefined, { numeric: true, sensitivity: "base" });
      } else if (this._sortBy === "cr-asc") {
        const crA = parseCrValue(a.cr);
        const crB = parseCrValue(b.cr);
        if (crA !== crB) return crA - crB;
        return nameA.localeCompare(nameB);
      } else if (this._sortBy === "cr-desc") {
        const crA = parseCrValue(a.cr);
        const crB = parseCrValue(b.cr);
        if (crA !== crB) return crB - crA;
        return nameA.localeCompare(nameB);
      } else if (this._sortBy === "status-installed") {
        const instA = a.isInstalled ? 1 : 0;
        const instB = b.isInstalled ? 1 : 0;
        if (instA !== instB) return instB - instA;
        return nameA.localeCompare(nameB);
      } else if (this._sortBy === "status-updates") {
        const scoreA = a.isUpdate ? 2 : a.isNew ? 1 : 0;
        const scoreB = b.isUpdate ? 2 : b.isNew ? 1 : 0;
        if (scoreA !== scoreB) return scoreB - scoreA;
        return nameA.localeCompare(nameB);
      }
      return 0;
    });

    // Attach selected state to rendering context
    const assetsWithSelection = filteredAssets.map((asset) => ({
      ...asset,
      selected: this._selectedAssets.has(asset.id),
      iconClass: asset.type === "audio" ? "fa-music" : asset.type === "video" ? "fa-video" : "fa-image",
      isBeneosActor: asset.source === "beneos" && asset.type === "actor"
    }));

    // Setup select options for status filtering
    const statusOptions = [
      { value: "all", label: "Status: All", selected: this._statusFilter === "all" },
      { value: "installed", label: "✅ Installed in World", selected: this._statusFilter === "installed" },
      { value: "cloud", label: "☁️ Cloud (Not Installed)", selected: this._statusFilter === "cloud" },
      { value: "update", label: "🔄 Updates Available", selected: this._statusFilter === "update" },
      { value: "new", label: "✨ New Releases", selected: this._statusFilter === "new" },
      { value: "locked", label: "🔒 Locked (Patreon)", selected: this._statusFilter === "locked" }
    ];

    // Setup select options for sorting
    const sortOptions = [
      { value: "name-asc", label: "Name (A → Z)", selected: this._sortBy === "name-asc" },
      { value: "name-desc", label: "Name (Z → A)", selected: this._sortBy === "name-desc" },
      { value: "cr-asc", label: "CR (Low → High)", selected: this._sortBy === "cr-asc" },
      { value: "cr-desc", label: "CR (High → Low)", selected: this._sortBy === "cr-desc" },
      { value: "status-installed", label: "Installed First", selected: this._sortBy === "status-installed" },
      { value: "status-updates", label: "Updates & New First", selected: this._sortBy === "status-updates" }
    ];

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
      statusFilter: this._statusFilter,
      statusOptions: statusOptions,
      sortBy: this._sortBy,
      sortOptions: sortOptions,
      selectedBatchAction: this._selectedBatchAction || "import-compendium",
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
      }).catch(err => {
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

    // Bind batch action select
    const batchActionSelect = content.querySelector("#jenne-batch-action-select");
    if (batchActionSelect) {
      batchActionSelect.value = this._selectedBatchAction || "import-compendium";
      batchActionSelect.addEventListener("change", (ev) => {
        this._selectedBatchAction = ev.target.value;
        this.render({ parts: ["main"] });
      });
    }

    // Bind column picker select
    const colPicker = content.querySelector("#column-picker");
    if (colPicker) {
      colPicker.value = this._assetsPerRow.toString();
      colPicker.addEventListener("change", (ev) => {
        this._assetsPerRow = parseInt(ev.target.value);
        this.render({ parts: ["main"] });
      });
    }

    // Bind sort selector
    const sortSelect = content.querySelector("#jenne-sort-select");
    if (sortSelect) {
      sortSelect.value = this._sortBy || "name-asc";
      sortSelect.addEventListener("change", (ev) => {
        this._sortBy = ev.target.value;
        this.render({ parts: ["main"] });
      });
    }

    // Bind status filter selector
    const statusSelect = content.querySelector("#jenne-status-filter-select");
    if (statusSelect) {
      statusSelect.value = this._statusFilter || "all";
      statusSelect.addEventListener("change", (ev) => {
        this._statusFilter = ev.target.value;
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
    content.querySelectorAll(".jenne-asset-card.draggable, .jenne-beneos-actor-card.draggable").forEach((card) => {
      card.addEventListener("dragstart", (ev) => {
        const tokenKey = card.dataset.tokenKey;
        if (tokenKey) {
          const dragData = {
            type: "Actor",
            tokenKey: tokenKey,
            beneosTokenKey: tokenKey,
            dragMode: card.dataset.dragMode || "cloud"
          };
          ev.dataTransfer.setData("text/plain", JSON.stringify(dragData));
          return;
        }

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

    // Add double-click handlers for opening actor sheet/codex or lightbox preview
    content.querySelectorAll(".jenne-asset-card, .jenne-beneos-actor-card").forEach((card) => {
      card.addEventListener("dblclick", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const tokenKey = card.dataset.tokenKey;
        if (tokenKey) {
          JenneAssetManagerApp._onOpenBeneosActor.call(this, ev, { dataset: { key: tokenKey } });
          return;
        }
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

  async _openPreviewById(id) {
    if (id?.startsWith?.("beneos_actor_")) {
      const key = id.replace(/^beneos_actor_/, "");
      const { JenneCreatureArtworkModal } = await import("./creature-artwork-modal.mjs");
      return JenneCreatureArtworkModal.openForCreature({ key });
    }

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

    if (found?.type === "actor" && found?.key) {
      const { JenneCreatureArtworkModal } = await import("./creature-artwork-modal.mjs");
      return JenneCreatureArtworkModal.openForCreature({ key: found.key, raw: found.raw });
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
    const visibleCards = this.element.querySelectorAll(".jenne-asset-card, .jenne-beneos-actor-card");
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

  static async _onInstallBeneosActor(event, target) {
    event.preventDefault();
    event.stopPropagation();
    const key = target.dataset.key;
    if (!key) return;

    target.disabled = true;
    target.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i>`;

    try {
      ui.notifications.info(`Installing Beneos Creature "${key}"...`);
      await BeneosAdapter.install({ key: key, type: "actor" }, { key: key });
      ui.notifications.info(`Beneos Creature "${key}" installed successfully!`);
      this.render();
    } catch (err) {
      console.error("Jenne Asset Manager | Error installing Beneos actor:", err);
      ui.notifications.error(`Failed to install creature: ${err.message}`);
      target.disabled = false;
      target.innerHTML = `<i class="fa-solid fa-cloud-arrow-down"></i> Install`;
    }
  }

  static async _onOpenBeneosActor(event, target) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    const key = target?.dataset?.key || target?.dataset?.tokenKey;
    if (!key) return;

    const { JenneCreatureArtworkModal } = await import("./creature-artwork-modal.mjs");
    return JenneCreatureArtworkModal.openForCreature({ key });
  }

  static async _onTriggerBatchAction(event, target) {
    if (this._selectedAssets.size === 0) {
      ui.notifications.warn("Please select at least one asset to perform this action.");
      return;
    }

    const action = this._selectedBatchAction || "import-compendium";
    const selectedIds = Array.from(this._selectedAssets);

    if (action === "import-compendium") {
      return await JenneAssetManagerApp._onTriggerImport.call(this, event, target);
    }

    if (action === "beneos-install") {
      await this._executeBeneosBatchInstall(selectedIds);
    } else if (action === "beneos-update") {
      await this._executeBeneosBatchUpdate(selectedIds);
    } else if (action === "beneos-uninstall") {
      await this._executeBeneosBatchUninstall(selectedIds);
    }
  }

  async _executeBeneosBatchInstall(selectedIds) {
    if (!BeneosAdapter.isAvailable) {
      return ui.notifications.warn("Beneos module is not active in Foundry.");
    }

    const tokensToInstall = selectedIds.map(id => id.replace(/^beneos_actor_/, ""));
    ui.notifications.info(`Starting batch download/install of ${tokensToInstall.length} Beneos creatures...`);

    let installedCount = 0;
    for (const key of tokensToInstall) {
      try {
        await BeneosAdapter.install({ key, type: "actor" }, { key });
        installedCount++;
      } catch (err) {
        console.error(`Jenne Asset Manager | Error installing "${key}":`, err);
      }
    }

    ui.notifications.info(`Successfully installed ${installedCount} of ${tokensToInstall.length} creatures.`);
    this._selectedAssets.clear();
    this.render();
  }

  async _executeBeneosBatchUpdate(selectedIds) {
    if (!BeneosAdapter.isAvailable) {
      return ui.notifications.warn("Beneos module is not active in Foundry.");
    }

    const tokensToUpdate = selectedIds.map(id => id.replace(/^beneos_actor_/, ""));
    ui.notifications.info(`Starting batch update of ${tokensToUpdate.length} Beneos creatures...`);

    let updatedCount = 0;
    for (const key of tokensToUpdate) {
      try {
        await BeneosAdapter.install({ key, type: "actor" }, { key });
        updatedCount++;
      } catch (err) {
        console.error(`Jenne Asset Manager | Error updating "${key}":`, err);
      }
    }

    ui.notifications.info(`Successfully updated ${updatedCount} creatures.`);
    this._selectedAssets.clear();
    this.render();
  }

  async _executeBeneosBatchUninstall(selectedIds) {
    if (!BeneosAdapter.isAvailable) {
      return ui.notifications.warn("Beneos module is not active in Foundry.");
    }

    const count = selectedIds.length;
    Dialog.confirm({
      title: "Batch Uninstall Confirmation",
      content: `
        <div style="font-family: 'Signika', sans-serif; padding: 5px;">
          <p>Are you sure you want to uninstall and remove <strong>${count}</strong> selected Beneos creatures from this World?</p>
          <p style="color: #e57373; font-size: 0.9em;">This will delete all corresponding World Actor documents for these creatures.</p>
        </div>
      `,
      yes: async () => {
        ui.notifications.info(`Uninstalling ${count} creatures...`);
        let uninstalledCount = 0;
        for (const id of selectedIds) {
          try {
            const key = id.replace(/^beneos_actor_/, "");
            await BeneosAdapter.uninstall({ key, type: "actor" }, { key });
            uninstalledCount++;
          } catch (err) {
            console.error(`Jenne Asset Manager | Error uninstalling "${id}":`, err);
          }
        }
        ui.notifications.info(`Successfully uninstalled ${uninstalledCount} creatures.`);
        this._selectedAssets.clear();
        this.render();
      },
      no: () => {}
    });
  }
}
