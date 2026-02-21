const {
  app,
  BrowserWindow,
  Menu,
  ipcMain,
  desktopCapturer,
  dialog,
  Tray,
  globalShortcut,
  shell,
  Notification,
} = require("electron");
const path = require("path");
const fs = require("fs");
const ffmpeg = require("fluent-ffmpeg");
const { setupLogger, log } = require("../utils/logger");
const {
  loadSettings,
  saveSettings,
  getSettings,
  addRecentRecording,
  generateFilename,
  removeRecentRecording,
  clearRecentRecordings,
} = require("../utils/settings");
const { convertVideo } = require("../utils/ffmpeg");

function showRecordingNotification(filePath) {
  try {
    const settings = getSettings();
    if (settings.showNotifications !== false) {
      const fileName = path.basename(filePath);
      if (Notification.isSupported()) {
        const notification = new Notification({
          title: "Recording Complete",
          body: `Your recording has been saved: ${fileName}`,
          icon: ICON_PATH,
        });
        notification.on("click", () => {
          shell.showItemInFolder(filePath);
        });
        notification.show();
      }
    }
  } catch (err) {
    log("error", `Failed to show notification: ${err.message}`);
  }
}

app.disableHardwareAcceleration();

app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("disable-gpu-compositing");

let mainWindow = null;
let tray = null;
let isRecording = false;
let currentRecordingPath = null;
let shortcutRegistered = false;

const isDev = !app.isPackaged;
const ICON_PATH = isDev
  ? path.join(__dirname, "..", "..", "frontend", "images", "appIcon.png")
  : path.join(process.resourcesPath, "appIcon.png");

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
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

  mainWindow.loadFile(path.join(__dirname, "..", "renderer", "index.html"));

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    log("info", "Main window ready");
  });

  mainWindow.on("close", (e) => {
    if (isRecording) {
      e.preventDefault();
      const choice = dialog.showMessageBoxSync(mainWindow, {
        type: "question",
        buttons: ["Yes", "No"],
        title: "Recording in Progress",
        message: "Recording is in progress. Do you want to stop and quit?",
        defaultId: 1,
      });

      if (choice === 0) {
        mainWindow.webContents.send("stop-recording-from-quit");
      }
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  if (isDev) {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }
}

function createTray() {
  try {
    tray = new Tray(ICON_PATH);
    tray.setToolTip("Oca Screen Recorder");

    const contextMenu = Menu.buildFromTemplate([
      {
        label: "Show Recorder",
        click: () => {
          if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
          }
        },
      },
      {
        label: "Quit",
        click: () => {
          app.quit();
        },
      },
    ]);

    tray.setContextMenu(contextMenu);

    tray.on("click", () => {
      if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
      }
    });

    log("info", "System tray created");
  } catch (err) {
    log("error", `Failed to create tray: ${err.message}`);
  }
}

function createRecordingTray() {
  if (tray) {
    tray.destroy();
    tray = null;
  }

  try {
    tray = new Tray(ICON_PATH);
    tray.setToolTip("Recording...");

    const contextMenu = Menu.buildFromTemplate([
      {
        label: "Pause Recording",
        click: () => {
          if (mainWindow) {
            mainWindow.webContents.send("pause-recording-from-tray");
          }
        },
      },
      {
        label: "Stop Recording",
        click: () => {
          if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
            mainWindow.webContents.send("stop-recording-from-tray");
          }
        },
      },
      { type: "separator" },
      {
        label: "Show Recorder",
        click: () => {
          if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
          }
        },
      },
    ]);

    tray.setContextMenu(contextMenu);

    tray.on("click", () => {
      if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
      }
    });

    log("info", "Recording tray created");
  } catch (err) {
    log("error", `Failed to create recording tray: ${err.message}`);
  }
}

function restoreNormalTray() {
  if (tray) {
    tray.destroy();
    tray = null;
  }
  createTray();
}

function createPausedTray() {
  if (tray) {
    tray.destroy();
    tray = null;
  }

  try {
    tray = new Tray(ICON_PATH);
    tray.setToolTip("Recording Paused");

    const contextMenu = Menu.buildFromTemplate([
      {
        label: "Resume Recording",
        click: () => {
          if (mainWindow) {
            mainWindow.webContents.send("resume-recording-from-tray");
          }
        },
      },
      {
        label: "Stop Recording",
        click: () => {
          if (mainWindow) {
            mainWindow.webContents.send("stop-recording-from-tray");
          }
        },
      },
      {
        label: "Show Recorder",
        click: () => {
          if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
          }
        },
      },
    ]);

    tray.setContextMenu(contextMenu);

    tray.on("click", () => {
      if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
      }
    });

    log("info", "Paused tray created");
  } catch (err) {
    log("error", `Failed to create paused tray: ${err.message}`);
  }
}

function registerGlobalShortcut() {
  const settings = getSettings();

  if (settings.shortcutEnabled && settings.shortcutKey) {
    try {
      globalShortcut.unregisterAll();
      globalShortcut.register(settings.shortcutKey, () => {
        if (isRecording && mainWindow) {
          mainWindow.show();
          mainWindow.focus();
          mainWindow.webContents.send("stop-recording-from-shortcut");
          log("info", "Stop recording triggered via global shortcut");
        }
      });
      shortcutRegistered = true;
      log("info", `Global shortcut registered: ${settings.shortcutKey}`);
    } catch (err) {
      log("error", `Failed to register shortcut: ${err.message}`);
    }
  } else {
    globalShortcut.unregisterAll();
    shortcutRegistered = false;
  }
}

async function getCaptureSources() {
  try {
    const sources = await desktopCapturer.getSources({
      types: ["window", "screen"],
      fetchWindowIcons: true,
      thumbnailSize: { width: 320, height: 180 },
    });
    return sources.map((source) => ({
      id: source.id,
      name: source.name,
      thumbnail: source.thumbnail.toDataURL(),
      display_id: source.display_id,
    }));
  } catch (err) {
    log("error", `Failed to get capture sources: ${err.message}`);
    return [];
  }
}

function getDiskSpace(dirPath) {
  try {
    const stats = fs.statfsSync ? fs.statfsSync(dirPath) : null;
    if (stats) {
      return {
        free: stats.bsize * stats.bfree,
        total: stats.bsize * stats.blocks,
      };
    }
  } catch (err) {
    log("warn", `Could not get disk space: ${err.message}`);
  }
  return null;
}

async function saveRecording(streamData) {
  const settings = getSettings();
  const tempDir = app.getPath("temp");
  const outputDir = settings.outputDirectory || app.getPath("videos");

  if (!streamData || streamData.byteLength === 0) {
    log("error", "No recording data to save");
    return { success: false, error: "No recording data available" };
  }

  if (!fs.existsSync(outputDir)) {
    try {
      fs.mkdirSync(outputDir, { recursive: true });
    } catch (mkdirErr) {
      log("error", `Failed to create output directory: ${mkdirErr.message}`);
      return { success: false, error: "Cannot access output directory" };
    }
  }

  const estimatedSize = streamData.byteLength * 1.5;
  const diskSpace = getDiskSpace(outputDir);

  if (diskSpace && diskSpace.free < estimatedSize) {
    const freeMB = Math.floor(diskSpace.free / (1024 * 1024));
    log("error", `Insufficient disk space: ${freeMB}MB available`);
    return {
      success: false,
      error: `Insufficient disk space. Only ${freeMB}MB available.`,
    };
  }

  const format = settings.defaultFormat || "mp4";
  const pattern = settings.filenamePattern || "Recording_{date}_{time}";
  const defaultName = generateFilename(pattern, format);
  const autoSave = settings.autoSave || false;

  let filePath;
  let canceled = false;

  if (autoSave) {
    filePath = path.join(outputDir, defaultName);
    let counter = 1;
    const basePath = filePath;
    while (fs.existsSync(filePath)) {
      const ext = path.extname(basePath);
      const name = path.basename(basePath, ext);
      filePath = path.join(outputDir, `${name}_${counter}${ext}`);
      counter++;
    }
    log("info", `Auto-saving to: ${filePath}`);
  } else {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: "Save Recording",
      defaultPath: path.join(outputDir, defaultName),
      filters: [
        { name: "MP4 Video", extensions: ["mp4"] },
        { name: "WebM Video", extensions: ["webm"] },
      ],
    });

    filePath = result.filePath;
    canceled = result.canceled;
  }

  if (canceled || !filePath) {
    log("info", "Save dialog canceled");
    return { success: false, canceled: true };
  }

  try {
    const tempFilePath = path.join(
      tempDir,
      `temp_recording_${Date.now()}.webm`,
    );
    const buffer = Buffer.from(new Uint8Array(streamData));

    if (buffer.length === 0) {
      log("error", "Recording data is empty");
      return { success: false, error: "Recording data is empty" };
    }

    fs.writeFileSync(tempFilePath, buffer);

    const stats = fs.statSync(tempFilePath);
    log(
      "info",
      `Recording saved to temp: ${tempFilePath}, size: ${stats.size} bytes`,
    );

    const ext = path.extname(filePath).toLowerCase();

    if (ext === ".mp4") {
      const convertedPath = filePath;

      mainWindow?.webContents.send("conversion-started");

      convertVideo(tempFilePath, convertedPath, (progress) => {
        mainWindow?.webContents.send("conversion-progress", progress);
      })
        .then(() => {
          if (fs.existsSync(tempFilePath)) {
            fs.unlinkSync(tempFilePath);
          }
          log("info", `Recording converted and saved: ${convertedPath}`);
          mainWindow?.webContents.send("conversion-complete", convertedPath);
          addRecentRecording(convertedPath);
          showRecordingNotification(convertedPath);
        })
        .catch((convertErr) => {
          log(
            "error",
            `Conversion failed: ${convertErr.message}, saving as webm`,
          );
          const webmPath = filePath.replace(/\.mp4$/i, ".webm");
          fs.renameSync(tempFilePath, webmPath);
          mainWindow?.webContents.send("conversion-complete", webmPath);
          addRecentRecording(webmPath);
          showRecordingNotification(webmPath);
        });

      return {
        success: true,
        filePath: convertedPath,
        backgroundProcessing: true,
      };
    } else {
      fs.renameSync(tempFilePath, filePath);
      log("info", `Recording saved: ${filePath}`);
      addRecentRecording(filePath);

      return { success: true, filePath };
    }
  } catch (err) {
    log("error", `Failed to save recording: ${err.message}`);
    return { success: false, error: err.message };
  }
}

function openFileLocation(filePath) {
  if (fs.existsSync(filePath)) {
    shell.showItemInFolder(filePath);
  } else {
    log("error", `File not found: ${filePath}`);
  }
}

async function openFile(filePath) {
  if (fs.existsSync(filePath)) {
    await shell.openPath(filePath);
  } else {
    log("error", `File not found: ${filePath}`);
  }
}

app.whenReady().then(async () => {
  setupLogger();
  await loadSettings();

  log("info", "Application starting...");
  log("info", `Running in ${isDev ? "development" : "production"} mode`);

  createWindow();
  createTray();
  registerGlobalShortcut();

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
  globalShortcut.unregisterAll();
  log("info", "Application closing");
});

ipcMain.handle("window-minimize", () => {
  mainWindow?.minimize();
});

ipcMain.handle("window-maximize", () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
    return false;
  } else {
    mainWindow?.maximize();
    return true;
  }
});

ipcMain.handle("window-close", () => {
  mainWindow?.close();
});

ipcMain.handle("window-is-maximized", () => {
  return mainWindow?.isMaximized() || false;
});

ipcMain.handle("get-capture-sources", async () => {
  return await getCaptureSources();
});

ipcMain.handle("get-audio-devices", async () => {
  return [];
});

ipcMain.handle("save-recording", async (_, streamData) => {
  return await saveRecording(streamData);
});

ipcMain.handle("open-file-location", async (_, filePath) => {
  openFileLocation(filePath);
});

ipcMain.handle("open-file", async (_, filePath) => {
  await openFile(filePath);
});

ipcMain.handle("set-recording-state", (_, recording, isPaused = false) => {
  isRecording = recording;

  if (recording && !isPaused) {
    createRecordingTray();
    const settings = getSettings();
    if (settings.hideWindowDuringRecording && mainWindow) {
      mainWindow.hide();
    }
  } else if (recording && isPaused) {
    createPausedTray();
  } else {
    restoreNormalTray();
    if (mainWindow && !mainWindow.isVisible()) {
      mainWindow.show();
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.focus();
    }
  }
});

ipcMain.handle("get-settings", () => {
  return getSettings();
});

ipcMain.handle("get-recent-recordings", () => {
  const settings = getSettings();
  return settings.recentRecordings || [];
});

ipcMain.handle("add-recent-recording", (_, filePath) => {
  addRecentRecording(filePath);
  return getSettings();
});

ipcMain.handle("remove-recent-recording", (_, filePath) => {
  removeRecentRecording(filePath);
  return getSettings();
});

ipcMain.handle("clear-recent-recordings", () => {
  clearRecentRecordings();
  return getSettings();
});

ipcMain.handle("remove-recent-recording-and-file", async (_, filePath) => {
  try {
    // attempt to delete file from disk if it exists
    if (filePath && fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (unlinkErr) {
        // Log error but continue to remove from recent list
        console.error("Failed to delete file:", unlinkErr);
        return { success: false, error: unlinkErr.message };
      }
    }

    removeRecentRecording(filePath);
    return { success: true };
  } catch (err) {
    console.error("remove-recent-recording-and-file error:", err);
    try {
      removeRecentRecording(filePath);
    } catch (e) {}
    return { success: false, error: err.message };
  }
});

ipcMain.handle("save-settings", (_, newSettings) => {
  if (!newSettings) {
    return getSettings();
  }

  const validatedSettings = {
    videoQuality: ["low", "medium", "high", "ultra"].includes(
      newSettings.videoQuality,
    )
      ? newSettings.videoQuality
      : "high",
    frameRate: [24, 30, 60].includes(newSettings.frameRate)
      ? newSettings.frameRate
      : 24,
    resolution: ["1280x720", "1920x1080", "2560x1440", "3840x2160"].includes(
      newSettings.resolution,
    )
      ? newSettings.resolution
      : "1920x1080",
    recordAudio: Boolean(newSettings.recordAudio),
    recordSystemAudio: Boolean(newSettings.recordSystemAudio),
    selectedMicrophone: newSettings.selectedMicrophone || "default",
    outputDirectory: newSettings.outputDirectory || "",
    shortcutEnabled: Boolean(newSettings.shortcutEnabled),
    shortcutKey: [
      "F9",
      "F10",
      "F11",
      "F12",
      "CommandOrControl+Shift+R",
    ].includes(newSettings.shortcutKey)
      ? newSettings.shortcutKey
      : "F9",
    hideWindowDuringRecording: Boolean(newSettings.hideWindowDuringRecording),
    showNotifications: Boolean(newSettings.showNotifications),
    autoOpenAfterRecording: Boolean(newSettings.autoOpenAfterRecording),
    defaultFormat: ["mp4", "webm"].includes(newSettings.defaultFormat)
      ? newSettings.defaultFormat
      : "mp4",
    countdown: [0, 3, 5, 10].includes(parseInt(newSettings.countdown))
      ? parseInt(newSettings.countdown)
      : 5,
    filenamePattern: newSettings.filenamePattern || "Recording_{date}_{time}",
    compression: ["maximum", "balanced", "quality"].includes(
      newSettings.compression,
    )
      ? newSettings.compression
      : "balanced",
    hardwareAcceleration: ["none", "nvenc", "qsv", "amf"].includes(
      newSettings.hardwareAcceleration,
    )
      ? newSettings.hardwareAcceleration
      : "none",
    autoSave: Boolean(newSettings.autoSave),
  };

  saveSettings(validatedSettings);
  registerGlobalShortcut();
  return getSettings();
});

ipcMain.handle("show-save-dialog", async (_, options) => {
  const result = await dialog.showSaveDialog(mainWindow, options);
  return result;
});

ipcMain.handle("get-app-paths", () => {
  return {
    temp: app.getPath("temp"),
    videos: app.getPath("videos"),
    documents: app.getPath("documents"),
  };
});

ipcMain.handle("get-available-encoders", async () => {
  try {
    const ffmpegUtil = require("../utils/ffmpeg");
    const { getAvailableEncoders, resetEncoderCheck, getSystemFfmpegPath } =
      ffmpegUtil;
    resetEncoderCheck();
    const enc = await getAvailableEncoders();
    const systemPath = getSystemFfmpegPath();
    return { encoders: enc, systemFfmpeg: systemPath };
  } catch (err) {
    log("error", `Failed to get available encoders: ${err.message}`);
    return { nvenc: false, qsv: false, amf: false };
  }
});
