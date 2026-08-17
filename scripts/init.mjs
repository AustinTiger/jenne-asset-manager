import { JenneAssetManagerApp } from "./app/asset-manager-app.mjs";
import { BeneosBatchImporterApp } from "./app/beneos-batch-importer.mjs";
import { JenneDDBPatchApp } from "./app/ddb-patch-app.mjs";
import { setupCanvasDrop } from "./canvas-drop.mjs";

Hooks.once("init", () => {
  console.log("Jenne Asset Manager | Initializing module...");
  
  // Expose to global scope for debugging and macros
  globalThis.JenneAssetManagerApp = JenneAssetManagerApp;
  globalThis.BeneosBatchImporterApp = BeneosBatchImporterApp;
  globalThis.JenneDDBPatchApp = JenneDDBPatchApp;

  // Register Settings
  game.settings.register("jenne-asset-manager", "sourceDirectoriesList", {
    scope: "world",
    config: false,
    type: Array,
    default: []
  });

  game.settings.register("jenne-asset-manager", "debugMode", {
    name: "Debug Mode",
    hint: "Enable detailed logging in the console for scanning and parsing processes.",
    scope: "world",
    config: true,
    type: Boolean,
    default: false
  });
});

Hooks.once("ready", () => {
  console.log("Jenne Asset Manager | Ready");
  
  // Set up drop listeners on the canvas
  setupCanvasDrop();
});

// Add a button to the Jenne Suite tools sidebar
Hooks.on("getSceneControlButtons", (controls) => {
  if (!game.user.isGM) return;

  console.log("Jenne Asset Manager | getSceneControlButtons received controls:", controls);

  // Check if our custom Jenne Suite group already exists in the sidebar controls (compatibility for array/object structures)
  let jenneSuite;
  const isArray = Array.isArray(controls);
  if (isArray) {
    jenneSuite = controls.find(c => c.name === "jenne-suite");
  } else {
    jenneSuite = controls["jenne-suite"];
  }

  if (!jenneSuite) {
    jenneSuite = {
      name: "jenne-suite",
      title: "Jenne Suite",
      icon: "fa-solid fa-j",
      layer: "jenneSuite",
      visible: true,
      tools: isArray ? [] : {}
    };
    if (isArray) {
      controls.push(jenneSuite);
    } else {
      controls["jenne-suite"] = jenneSuite;
    }
    console.log("Jenne Asset Manager | Initialized 'jenne-suite' control group fallback");
  }

  // Ensure tools is properly initialized for compatibility
  if (!jenneSuite.tools) {
    jenneSuite.tools = isArray ? [] : {};
  }

  // Helper to add a tool compatibly
  const addTool = (tool) => {
    const isToolsArray = Array.isArray(jenneSuite.tools);
    if (isToolsArray) {
      if (!jenneSuite.tools.some(t => t.name === tool.name)) {
        jenneSuite.tools.push(tool);
      }
    } else {
      jenneSuite.tools[tool.name] = tool;
    }
  };

  // Define our Asset Manager tool button
  const tool = {
    name: "jenne-asset-manager",
    title: "Jenne Asset Manager",
    icon: "fa-solid fa-boxes-stacked",
    button: true,
    visible: true,
    onChange: () => {
      new JenneAssetManagerApp().render({ force: true });
    }
  };
  addTool(tool);

  // Define our DDB Importer Patch tool button
  const ddbTool = {
    name: "ddb-patcher",
    title: "Patch D&D Beyond Importer",
    icon: "fas fa-dragon",
    button: true,
    visible: true,
    onChange: () => {
      new JenneDDBPatchApp().render({ force: true });
    }
  };
  addTool(ddbTool);

  // Define our Auto Color tool button
  const autoColorTool = {
    name: "jenne-auto-color",
    title: "Jenne Auto Color Settings",
    icon: "fas fa-palette",
    button: true,
    visible: true,
    onChange: () => {
      // Check if module is active
      if (!game.modules.get('jenne-auto-color')?.active) {
        return ui.notifications.error("The 'Jenne Auto Color' module must be active to configure it.");
      }

      // Open Settings Config
      const settingsApp = new SettingsConfig();
      settingsApp.render(true);
      
      // Wait for it to render and scroll to the Jenne Auto Color settings
      Hooks.once("renderSettingsConfig", (app, html) => {
         const el = html.jquery ? html[0] : html;
         
         // Activate the modules tab if possible
         if (app.tabs && app.tabs[0]) {
             app.tabs[0].activate("modules");
         } else {
             const tabBtn = el.querySelector('a[data-tab="modules"], .item[data-tab="modules"]');
             if (tabBtn) tabBtn.click();
         }
         
         setTimeout(() => {
             // Find a setting input for jenne-auto-color to scroll into view
             const input = el.querySelector('[name^="jenne-auto-color."]');
             if (input) {
                 const container = input.closest('.form-group') || input;
                 container.scrollIntoView({ behavior: "smooth", block: "center" });
                 // Briefly flash the background to highlight it
                 const originalBg = container.style.backgroundColor;
                 container.style.transition = "background-color 0.5s ease";
                 container.style.backgroundColor = "rgba(100, 150, 255, 0.3)";
                 setTimeout(() => { container.style.backgroundColor = originalBg; }, 1500);
             }
         }, 100);
      });
    }
  };
  addTool(autoColorTool);
});
