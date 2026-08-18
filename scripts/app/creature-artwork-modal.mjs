/**
 * Jenne Creature Artwork & Token Inspector Modal
 * Displays all associated 2.5D tokens, Top-Down tokens, portraits, and variant artwork for a creature.
 */

export class JenneCreatureArtworkModal extends foundry.applications.api.ApplicationV2 {
  constructor(options = {}) {
    super(options);
    this._key = options.key || "";
    this._actor = options.actor || null;
    this._raw = options.raw || null;
    this._activeTab = options.activeTab || "artwork"; // "artwork" | "codex"
  }

  static DEFAULT_OPTIONS = {
    id: "jenne-creature-artwork-modal",
    classes: ["jenne-asset-manager", "jenne-artwork-modal"],
    tag: "div",
    window: {
      title: "Creature Artwork & Token Inspector",
      icon: "fas fa-palette",
      resizable: true,
      minimizable: true
    },
    position: {
      width: 780,
      height: 620
    },
    actions: {
      selectModalTab: JenneCreatureArtworkModal._onSelectModalTab,
      applyTokenTexture: JenneCreatureArtworkModal._onApplyTokenTexture,
      applyPortrait: JenneCreatureArtworkModal._onApplyPortrait,
      installCreature: JenneCreatureArtworkModal._onInstallCreature,
      openSheet: JenneCreatureArtworkModal._onOpenSheet
    }
  };

  static PARTS = {
    main: {
      template: "modules/jenne-asset-manager/templates/creature-artwork-modal.hbs"
    }
  };

  /**
   * Opens the Artwork Modal for a given creature key or actor
   */
  static async openForCreature({ key, actor = null, raw = null } = {}) {
    if (!key && actor) {
      key = actor.getFlag?.("world", "beneos")?.tokenKey || 
            actor.getFlag?.("world", "beneos")?.fullId || 
            actor.getFlag?.("beneos-module", "key") ||
            actor.name.toLowerCase().replace(/[^a-z0-9]/g, "");
    }
    if (!key) return;

    // Resolve raw database info if not provided
    if (!raw && game.beneos?.databaseHolder?.get) {
      raw = game.beneos.databaseHolder.get("token", key) || 
            game.beneos.databaseHolder.get("token", key.toLowerCase().replace(/[^a-z0-9]/g, ""));
    }

    // Resolve actor if not provided
    if (!actor) {
      const cleanKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");
      actor = game.actors.find(a => {
        const flag = a.getFlag?.("world", "beneos") || a.getFlag?.("beneos-module", "key");
        if (flag && (flag.tokenKey === key || flag.fullId === key || flag === key)) return true;
        const cleanName = a.name.toLowerCase().replace(/[^a-z0-9]/g, "");
        return cleanName === cleanKey || (cleanKey.length > 4 && cleanName.includes(cleanKey));
      });
    }

    const modal = new JenneCreatureArtworkModal({
      key: key,
      actor: actor,
      raw: raw
    });

    return modal.render({ force: true });
  }

  /**
   * Opens the modal directly from an Actor document
   */
  static async openForActor(actor, beneosKey = null) {
    return this.openForCreature({ actor, key: beneosKey });
  }

  /** @override */
  async _prepareContext(options) {
    const raw = this._raw || (game.beneos?.databaseHolder?.get?.("token", this._key) ?? {});
    const props = raw.properties || {};
    const name = raw.name || props.title || this._actor?.name || this._key;

    // Format metadata
    let biomes = "";
    if (Array.isArray(props.biom)) biomes = props.biom.join(", ");
    else if (props.biom) biomes = String(props.biom);

    let typeStr = props.typeString || "";
    if (!typeStr) {
      if (Array.isArray(props.type)) typeStr = props.type.join(" / ");
      else if (props.type) typeStr = String(props.type);
      else typeStr = "Creature";
    }

    let movementStr = "";
    if (props.movement) {
      if (typeof props.movement === "object" && !Array.isArray(props.movement)) {
        movementStr = Object.entries(props.movement).map(([k, v]) => `${k} ${v}ft`).join(", ");
      } else if (Array.isArray(props.movement)) {
        movementStr = props.movement.join(", ");
      } else {
        movementStr = String(props.movement);
      }
    }

    const nbVariants = props.nb_variants || 1;
    const cleanKey = this._key.toLowerCase().replace(/[^a-z0-9]/g, "");

    // Build Artwork List
    const artworkList = [];
    const portraitSrc = raw.picture || raw.avatar || this._actor?.img || `https://www.beneos-database.com/tokens/${this._key}-1-db-avatar.webp`;

    // 1. Portrait Art
    artworkList.push({
      src: portraitSrc,
      backupSrc: `https://www.beneos-database.com/tokens/${this._key}-1-db-avatar.webp`,
      label: `${name} — Portrait Art`,
      description: "Full character portrait & codex illustration.",
      style: "portrait",
      styleLabel: "Portrait",
      isPortrait: true,
      isToken: false,
      isVideo: false
    });

    // 2. Token Variants (2.5D Isometric & Top-Down)
    for (let i = 1; i <= nbVariants; i++) {
      // 2.5D Isometric
      artworkList.push({
        src: `https://www.beneos-database.com/tokens/${this._key}-${i}-db-token.webp`,
        thumbUrl: `https://www.beneos-database.com/tokens/${this._key}-${i}-db-token.webp`,
        backupSrc: `https://www.beneos-database.com/tokens/${this._key}-1-db-token.webp`,
        label: nbVariants > 1 ? `Variant ${i} — 2.5D Isometric Token` : "2.5D Isometric Animated Token",
        description: "Front-facing isometric animated & still battle token.",
        style: "2.5d",
        styleLabel: "2.5D Front",
        isPortrait: false,
        isToken: true,
        isVideo: false
      });

      // Top-Down
      artworkList.push({
        src: `https://www.beneos-database.com/tokens/${this._key}-${i}-db-top.webp`,
        thumbUrl: `https://www.beneos-database.com/tokens/${this._key}-${i}-db-top.webp`,
        backupSrc: `https://www.beneos-database.com/tokens/${this._key}-1-db-top.webp`,
        label: nbVariants > 1 ? `Variant ${i} — Top-Down Token` : "Top-Down Animated Token",
        description: "True overhead perspective animated & still battle token.",
        style: "topdown",
        styleLabel: "Top-Down",
        isPortrait: false,
        isToken: true,
        isVideo: false
      });
    }

    return {
      key: this._key,
      name: name,
      cr: props.cr !== undefined ? String(props.cr) : "0",
      creatureType: typeStr,
      biome: biomes,
      movement: movementStr,
      nbVariants: nbVariants,
      description: props.description || props.lore || raw.description || "",
      isInstalled: !!this._actor || !!raw.isInstalled,
      hasActor: !!this._actor,
      portraitSrc: portraitSrc,
      artworkList: artworkList,
      activeTab: this._activeTab
    };
  }

  static _onSelectModalTab(event, target) {
    const tab = target.dataset.tab;
    if (tab) {
      this._activeTab = tab;
      this.render({ parts: ["main"] });
    }
  }

  static async _onApplyTokenTexture(event, target) {
    const src = target.dataset.src;
    const style = target.dataset.style || "token";
    if (!src || !this._actor) {
      return ui.notifications.warn("No active Actor document bound to update token texture.");
    }

    try {
      await this._actor.update({
        "prototypeToken.texture.src": src,
        "flags.beneos-module.tokenStyle": style
      });

      // Also update currently placed tokens for this actor on the active canvas
      const placed = canvas.tokens?.placeables?.filter(t => t.actor?.id === this._actor.id) || [];
      for (const tok of placed) {
        await tok.document.update({ "texture.src": src });
      }

      ui.notifications.info(`Updated "${this._actor.name}" token texture to ${style.toUpperCase()}!`);
    } catch (err) {
      console.error("Jenne Asset Manager | Error updating token texture:", err);
      ui.notifications.error(`Failed to update token texture: ${err.message}`);
    }
  }

  static async _onApplyPortrait(event, target) {
    const src = target.dataset.src;
    if (!src || !this._actor) {
      return ui.notifications.warn("No active Actor document bound to update portrait.");
    }

    try {
      await this._actor.update({ "img": src });
      ui.notifications.info(`Updated "${this._actor.name}" portrait image!`);
    } catch (err) {
      console.error("Jenne Asset Manager | Error updating portrait:", err);
      ui.notifications.error(`Failed to update portrait: ${err.message}`);
    }
  }

  static async _onInstallCreature(event, target) {
    const key = this._key;
    if (!key) return;

    target.disabled = true;
    target.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Installing...`;

    try {
      const { BeneosAdapter } = await import("../adapters/beneos-adapter.mjs");
      ui.notifications.info(`Installing Beneos creature "${key}"...`);
      await BeneosAdapter.install({ key: key, type: "actor" }, { key: key });
      ui.notifications.info(`Beneos creature "${key}" installed successfully!`);
      
      // Refresh actor binding
      this._actor = game.actors.find(a => 
        a.flags?.["beneos-module"]?.key === key || 
        a.name.toLowerCase().replace(/[^a-z0-9]/g, "") === key.toLowerCase().replace(/[^a-z0-9]/g, "")
      );
      this.render({ parts: ["main"] });
    } catch (err) {
      console.error("Jenne Asset Manager | Installation error:", err);
      ui.notifications.error(`Failed to install creature: ${err.message}`);
      target.disabled = false;
      target.innerHTML = `<i class="fas fa-cloud-arrow-down"></i> Install Creature`;
    }
  }

  static _onOpenSheet(event, target) {
    if (this._actor) {
      this._actor.sheet.render(true);
    } else {
      ui.notifications.warn("Actor document not found in world.");
    }
  }
}
