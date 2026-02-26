const { app, BrowserWindow, protocol } = require("electron");
const path = require("path");
const { setupLogger, log } = require("../utils/logger");
const { loadSettings } = require("../utils/settings");
const tray = require("./tray");
const shortcuts = require("./shortcuts");
const { setupIpcHandlers, setMainWindowRef, setOverlayWindowRef } = require("./ipc-handlers");

app.disableHardwareAcceleration();

app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("disable-gpu-compositing");

let mainWindow = null;
let overlayWindow = null;

const isDev = !app.isPackaged;
const ICON_PATH = isDev
  ? path.join(__dirname, "..", "..", "appIcon.png")
  : path.join(process.resourcesPath, "appIcon.png");

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1080,
    height: 700,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    transparent: false,
    backgroundColor: "#1a1a2e",
    show: false,
    icon: ICON_PATH,
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  });

  tray.setMainWindow(mainWindow);
  tray.setIconPath(ICON_PATH);
  shortcuts.setMainWindow(mainWindow);
  setMainWindowRef(mainWindow, ICON_PATH);

  mainWindow.loadFile(path.join(__dirname, "..", "renderer", "index.html"));

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    log("info", "Main window ready");
  });

  mainWindow.on("close", (e) => {
    const state = require("./state");
    if (state.getRecordingState()) {
      e.preventDefault();
      const { dialog } = require("electron");
      const choice = dialog.showMessageBoxSync(mainWindow, {
        type: "question",
        buttons: ["Yes", "No"],
        title: "Recording in Progress",
        message: "Recording is in progress. Do you want to stop and quit?",
        defaultId: 1,
      });

      if (choice === 0) {
        mainWindow.hide();
        mainWindow.webContents.send("stop-recording-from-quit");
      }
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
    app.quit();
  });

  if (isDev) {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }
}

app.whenReady().then(async () => {
  setupLogger();
  await loadSettings();

  log("info", "Application starting...");
  log("info", `Running in ${isDev ? "development" : "production"} mode`);

  // Register thumb:// protocol
  protocol.registerFileProtocol("thumb", (request, callback) => {
    const url = request.url.replace("thumb://", "");
    try {
      return callback(decodeURIComponent(url));
    } catch (error) {
      console.error("Failed to register protocol", error);
    }
  });

  setupIpcHandlers();
  createWindow();
  createOverlayWindow();
  setOverlayWindowRef(overlayWindow);
  tray.createTray();
  shortcuts.registerGlobalShortcut();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("will-quit", () => {
  shortcuts.unregisterAllShortcuts();
  tray.destroyTray();
  log("info", "Application closing");
});

module.exports = {
  getMainWindow: () => mainWindow,
  getOverlayWindow: () => overlayWindow,
};

function createOverlayWindow() {
  overlayWindow = new BrowserWindow({
    width: 1920,
    height: 1080,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    type: "toolbar",
    hasShadow: false,
    resizable: false,
    focusable: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "overlay-preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  });

  overlayWindow.setAlwaysOnTop(true, "status");

  // Load the overlay
  overlayWindow.loadFile(path.join(__dirname, "..", "renderer", "overlay.html"));

  overlayWindow.on("closed", () => {
    overlayWindow = null;
  });
}
