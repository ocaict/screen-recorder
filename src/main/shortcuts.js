const { globalShortcut } = require("electron");
const { log } = require("../utils/logger");
const { getSettings } = require("../utils/settings");

let shortcutRegistered = false;
let mainWindow = null;

function setMainWindow(window) {
  mainWindow = window;
}

function registerGlobalShortcut() {
  const settings = getSettings();

  log("info", `Registering shortcut: enabled=${settings.shortcutEnabled}, key=${settings.shortcutKey}`);

  if (settings.shortcutEnabled && settings.shortcutKey) {
    try {
      globalShortcut.unregisterAll();
      const registered = globalShortcut.register(settings.shortcutKey, () => {
        log("info", `Shortcut ${settings.shortcutKey} triggered`);
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
          mainWindow.webContents.send("stop-recording-from-shortcut");
          log("info", "Stop recording triggered via global shortcut");
        }
      });
      
      if (registered) {
        shortcutRegistered = true;
        log("info", `Global shortcut registered successfully: ${settings.shortcutKey}`);
      } else {
        shortcutRegistered = false;
        log("warn", `Failed to register shortcut: ${settings.shortcutKey} - may be in use by another app`);
      }
    } catch (err) {
      log("error", `Failed to register shortcut: ${err.message}`);
      shortcutRegistered = false;
    }
  } else {
    globalShortcut.unregisterAll();
    shortcutRegistered = false;
    log("info", "Global shortcut disabled");
  }
}

function unregisterAllShortcuts() {
  globalShortcut.unregisterAll();
  shortcutRegistered = false;
}

function isShortcutRegistered() {
  return shortcutRegistered;
}

module.exports = {
  setMainWindow,
  registerGlobalShortcut,
  unregisterAllShortcuts,
  isShortcutRegistered,
};
