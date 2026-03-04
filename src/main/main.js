const { app, BrowserWindow, protocol, net } = require("electron");
const path = require("path");
const { pathToFileURL } = require("url");
const { setupLogger, log } = require("../utils/logger");
const { loadSettings } = require("../utils/settings");
const tray = require("./tray");
const shortcuts = require("./shortcuts");
const {
  setupIpcHandlers,
  setMainWindowRef,
  setOverlayWindowRef,
  setMiniControlsWindowRef,
  setCameraWindowRef,
} = require("./ipc-handlers");

// We've commented these out because setExcludeFromCapture (WDA_EXCLUDEFROMCAPTURE)
// often requires the GPU compositor (DWM) to be active to reliably hide windows from capture.
// app.disableHardwareAcceleration();
// app.commandLine.appendSwitch("disable-gpu");
// app.commandLine.appendSwitch("disable-gpu-compositing");

let mainWindow = null;
let overlayWindow = null;
let miniControlsWindow = null;
let cameraWindow = null;

// Register thumb:// as a privileged scheme for Electron 40+ compatibility
protocol.registerSchemesAsPrivileged([
  {
    scheme: "thumb",
    privileges: {
      standard: true, // Crucial for proper path/origin handling
      bypassCSP: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

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
    resizable: false,
    show: false,
    icon: ICON_PATH,
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      backgroundThrottling: false,
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

  mainWindow.on("minimize", () => {
    mainWindow.webContents.send("window-minimized");
  });

  mainWindow.on("restore", () => {
    mainWindow.webContents.send("window-restored");
  });
}

app.whenReady().then(async () => {
  setupLogger();
  await loadSettings();

  log("info", "Application starting...");
  log("info", `Running in ${isDev ? "development" : "production"} mode`);
  log("info", `Electron version: ${process.versions.electron}`);

  // Register thumb:// protocol using the modern Electron handle API
  protocol.handle("thumb", (request) => {
    try {
      const url = new URL(request.url);

      // 1. Combine host and pathname to get the full Windows path
      // Standard URLs split C:/Users into host='c:' and pathname='/Users'
      let p = decodeURIComponent(url.host + url.pathname);

      if (process.platform === "win32") {
        // Remove leading slash if Chromium added one before the drive letter
        if (p.startsWith("/")) p = p.slice(1);

        // Fix drive letter colon if it was mangled: "c/Users" -> "c:/Users"
        if (/^[a-zA-Z]\//.test(p)) {
          p = p[0] + ":" + p.slice(1);
        }
      }

      // 2. Normalize for the OS
      const finalPath = path.normalize(p);

      // 3. Read the file directly
      const fs = require("fs");
      if (fs.existsSync(finalPath)) {
        return new Response(fs.readFileSync(finalPath), {
          headers: { "Content-Type": "image/png" },
        });
      }

      console.warn("Thumbnail file not found:", finalPath);
      return new Response(null, { status: 404 });
    } catch (error) {
      console.error("Failed to handle thumb protocol:", error);
      return new Response(null, { status: 500 });
    }
  });

  setupIpcHandlers();
  createWindow();
  createOverlayWindow();
  createMiniControlsWindow();
  createCameraWindow();
  setOverlayWindowRef(overlayWindow);
  setMiniControlsWindowRef(miniControlsWindow);
  setCameraWindowRef(cameraWindow);
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
  getMiniControlsWindow: () => miniControlsWindow,
  getCameraWindow: () => cameraWindow,
};

function createCameraWindow() {
  cameraWindow = new BrowserWindow({
    width: 200,
    height: 200,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    focusable: false,
    show: false,
    backgroundColor: "#00000000",
    hasShadow: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false, // Set to false to allow direct camera access if needed, though preload is safer
      sandbox: false,
    },
  });

  cameraWindow.setAspectRatio(1); // Force perfect square/circle resizes


  // Exclude from capture
  if (process.platform === "win32") {
    if (typeof cameraWindow.setExcludeFromCapture === "function") {
      cameraWindow.setExcludeFromCapture(true);
    }
    if (typeof cameraWindow.setContentProtection === "function") {
      cameraWindow.setContentProtection(true);
    }
  }

  cameraWindow.setAlwaysOnTop(true, "screen-saver");
  cameraWindow.loadFile(path.join(__dirname, "..", "renderer", "camera.html"));

  cameraWindow.on("closed", () => {
    cameraWindow = null;
  });
}

function createOverlayWindow() {
  overlayWindow = new BrowserWindow({
    height: 1080,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    resizable: false,
    focusable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "overlay-preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  });

  overlayWindow.setAlwaysOnTop(true, "status");
  overlayWindow.setFocusable(false);
  overlayWindow.setIgnoreMouseEvents(true, { forward: true });

  // Load the overlay
  overlayWindow.loadFile(
    path.join(__dirname, "..", "renderer", "overlay.html"),
  );

  overlayWindow.on("closed", () => {
    overlayWindow = null;
  });
}

function createMiniControlsWindow() {
  miniControlsWindow = new BrowserWindow({
    width: 480,
    height: 100,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    focusable: true,
    show: false,
    icon: ICON_PATH,
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "mini-preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  });

  // CRITICAL: Hide this window from screen capture/recordings
  if (process.platform === "win32") {
    if (typeof miniControlsWindow.setExcludeFromCapture === "function") {
      miniControlsWindow.setExcludeFromCapture(true);
    }
    if (typeof miniControlsWindow.setContentProtection === "function") {
      miniControlsWindow.setContentProtection(true);
    }
  }

  miniControlsWindow.setAlwaysOnTop(true, "screen-saver");
  miniControlsWindow.loadFile(
    path.join(__dirname, "..", "renderer", "mini-controls.html"),
  );

  miniControlsWindow.on("closed", () => {
    miniControlsWindow = null;
  });
}
