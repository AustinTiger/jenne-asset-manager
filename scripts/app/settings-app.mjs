import { ASSET_TYPES } from "../config.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class JenneSettingsApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options = {}) {
    super(options);
    
    // Load from module settings or start with empty list
    const current = game.settings.get("jenne-asset-manager", "sourceDirectoriesList") || [];
    
    // Reset if it's the old format (missing sourceMode)
    const isOldFormat = current.some(row => row.sourceMode === undefined);
    if (isOldFormat) {
      this._directories = [];
      game.settings.set("jenne-asset-manager", "sourceDirectoriesList", []);
    } else {
      // Deep clone rows to prevent direct mutation of setting before save
      this._directories = current.map(row => ({
        type: row.type || "actors",
        sourceMode: row.sourceMode || "directory",
        path: row.path || "",
        compendium: row.compendium || "",
        tags: Array.isArray(row.tags) ? [...row.tags] : []
      }));
    }
  }

  static DEFAULT_OPTIONS = {
    id: "jenne-settings-app",
    classes: ["jenne-asset-manager", "jenne-settings-window"],
    tag: "div",
    window: {
      title: "Jenne Asset Manager Settings",
      icon: "fas fa-cog",
      resizable: true,
      minimizable: false
    },
    position: {
      width: 650,
      height: 550
    },
    actions: {
      addDirectory: JenneSettingsApp._onAddDirectory,
      deleteDirectory: JenneSettingsApp._onDeleteDirectory,
      browseDirectory: JenneSettingsApp._onBrowseDirectory,
      saveSettings: JenneSettingsApp._onSaveSettings,
      toggleTag: JenneSettingsApp._onToggleTag
    }
  };

  static PARTS = {
    main: {
      template: "modules/jenne-asset-manager/templates/settings.hbs"
    }
  };

  /** @override */
  async _prepareContext(options) {
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

    // Map directories list, ensuring select selection works in template
    const directoriesWithTypes = this._directories.map((dir, index) => {
      const types = Object.entries(ASSET_TYPES).map(([key, config]) => ({
        value: key,
        label: config.label,
        selected: key === dir.type
      }));

      const allowedModes = ASSET_TYPES[dir.type]?.sources || ["directory"];
      const modes = allowedModes.map(m => ({
        value: m,
        label: m === "directory" ? "Local Directory" : "Compendium Pack",
        selected: m === dir.sourceMode
      }));

      const allowedTags = (ASSET_TYPES[dir.type]?.tags || []).map(tagName => ({
        name: tagName,
        active: dir.tags.includes(tagName)
      }));

      // Filter compendiums dynamically based on row type
      const targetDocType = typeDocMap[dir.type];
      const compendiumsList = targetDocType
        ? game.packs
            .filter((p) => p.metadata.type === targetDocType)
            .map((p) => ({
              id: p.metadata.id,
              label: p.metadata.label
            }))
        : [];

      return {
        ...dir,
        index: index,
        types: types,
        modes: modes,
        allowedTags: allowedTags,
        compendiumsList: compendiumsList
      };
    });

    return {
      directories: directoriesWithTypes,
      hasDirectories: this._directories.length > 0
    };
  }

  /** @override */
  _replaceHTML(result, content, options) {
    super._replaceHTML(result, content, options);

    // Listen to changes in the path text fields to keep local state in sync
    content.querySelectorAll(".jenne-setting-path").forEach(input => {
      input.addEventListener("change", (ev) => {
        const idx = parseInt(input.dataset.index);
        if (this._directories[idx]) {
          this._directories[idx].path = ev.target.value.trim();
        }
      });
    });

    // Listen to type changes
    content.querySelectorAll(".jenne-setting-type").forEach(select => {
      select.addEventListener("change", (ev) => {
        const idx = parseInt(select.dataset.index);
        if (this._directories[idx]) {
          const oldType = this._directories[idx].type;
          const newType = ev.target.value;
          if (oldType !== newType) {
            this._directories[idx].type = newType;
            // Filter tags to only allowed ones
            const allowedTagsForType = ASSET_TYPES[newType]?.tags || [];
            this._directories[idx].tags = this._directories[idx].tags.filter(t => allowedTagsForType.includes(t));
            
            // Ensure sourceMode is allowed for the new type
            const allowedModes = ASSET_TYPES[newType]?.sources || ["directory"];
            if (!allowedModes.includes(this._directories[idx].sourceMode)) {
              this._directories[idx].sourceMode = allowedModes[0];
            }
            this.render();
          }
        }
      });
    });

    // Listen to sourceMode changes
    content.querySelectorAll(".jenne-setting-mode").forEach(select => {
      select.addEventListener("change", (ev) => {
        const idx = parseInt(select.dataset.index);
        if (this._directories[idx]) {
          this._directories[idx].sourceMode = ev.target.value;
          this.render();
        }
      });
    });

    // Listen to compendium dropdown changes
    content.querySelectorAll(".jenne-setting-compendium").forEach(select => {
      select.addEventListener("change", (ev) => {
        const idx = parseInt(select.dataset.index);
        if (this._directories[idx]) {
          this._directories[idx].compendium = ev.target.value;
        }
      });
    });
  }

  // --- Actions ---

  static _onAddDirectory(event, target) {
    this._directories.push({
      type: "actors",
      sourceMode: "directory",
      path: "",
      compendium: "",
      tags: []
    });
    this.render();
  }

  static _onDeleteDirectory(event, target) {
    const idx = parseInt(target.dataset.index);
    this._directories.splice(idx, 1);
    this.render();
  }

  static _onBrowseDirectory(event, target) {
    const idx = parseInt(target.dataset.index);
    const row = this._directories[idx];
    if (!row) return;

    const FilePickerClass = globalThis.foundry?.applications?.apps?.FilePicker || globalThis.FilePicker;
    new FilePickerClass({
      type: "folder",
      current: row.path || "",
      callback: (selectedPath) => {
        row.path = selectedPath;
        this.render();
      }
    }).render(true);
  }

  static _onToggleTag(event, target) {
    const rowIndex = parseInt(target.dataset.rowIndex);
    const tagName = target.dataset.tagName;
    const row = this._directories[rowIndex];
    if (!row) return;

    if (row.tags.includes(tagName)) {
      row.tags = row.tags.filter(t => t !== tagName);
    } else {
      row.tags.push(tagName);
    }
    this.render();
  }

  static async _onSaveSettings(event, target) {
    // Clean up empty rows
    const cleaned = this._directories
      .map(row => ({
        type: row.type,
        sourceMode: row.sourceMode,
        path: row.path ? row.path.trim() : "",
        compendium: row.compendium ? row.compendium.trim() : "",
        tags: row.tags || []
      }))
      .filter(row => {
        if (row.sourceMode === "directory") {
          return row.path.length > 0;
        } else {
          return row.compendium.length > 0;
        }
      });

    // Save to settings
    await game.settings.set("jenne-asset-manager", "sourceDirectoriesList", cleaned);
    ui.notifications.info("Settings saved successfully.");

    // Trigger re-scan of the main manager app if open
    const openApp = Object.values(ui.windows).find(w => w instanceof globalThis.JenneAssetManagerApp);
    if (openApp) {
      ui.notifications.info("Refreshing asset catalog...");
      // Forcing re-scan by clearing catalog
      openApp._catalog = null;
      openApp.render({ force: true });
    }

    // Close settings app
    this.close();
  }
}
