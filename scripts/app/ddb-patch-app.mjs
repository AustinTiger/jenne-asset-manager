const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * An instructional popup window providing the command and information to patch
 * the D&D Beyond Importer module using the PowerShell script.
 */
export class JenneDDBPatchApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "jenne-ddb-patch-app",
    classes: ["jenne-asset-manager", "jenne-ddb-patch-window"],
    tag: "div",
    window: {
      title: "D&D Beyond Importer Patreon Unlock Patcher",
      icon: "fab fa-d-and-d",
      resizable: false,
      minimizable: false
    },
    position: {
      width: 550,
      height: "auto"
    },
    actions: {
      copyCommand: JenneDDBPatchApp._onCopyCommand,
      closeWindow: JenneDDBPatchApp._onCloseWindow
    }
  };

  static PARTS = {
    main: {
      template: "modules/jenne-asset-manager/templates/ddb-patch.hbs"
    }
  };

  /** @override */
  async _prepareContext(options) {
    return {};
  }

  /**
   * Action to copy the PowerShell patch command to the clipboard.
   * @param {Event} event - The triggering click event
   * @param {HTMLElement} target - The action target button
   */
  static async _onCopyCommand(event, target) {
    event.preventDefault();
    const commandElement = this.element.querySelector("#ddb-command-line");
    const commandText = commandElement 
      ? commandElement.textContent.trim() 
      : 'powershell -File "d:\\FoundryVtt\\Data\\modules\\jenne-suite\\scripts\\Patch-DDBImporter.ps1"';

    try {
      await navigator.clipboard.writeText(commandText);
      ui.notifications.info("PowerShell patch command copied to clipboard!");
    } catch (err) {
      console.error("Jenne Asset Manager | Failed to copy command:", err);
      ui.notifications.error("Failed to copy command to clipboard.");
    }
  }

  /**
   * Action to close the patch instructions popup.
   * @param {Event} event - The triggering click event
   * @param {HTMLElement} target - The action target button
   */
  static _onCloseWindow(event, target) {
    event.preventDefault();
    this.close();
  }
}
