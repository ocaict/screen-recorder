const {
  ipcMain,
  dialog,
  shell,
  desktopCapturer,
  app,
  Notification,
} = require("electron");
const path = require("path");
const fs = require("fs");
const { log } = require("../utils/logger");
const {
  getSettings,
  saveSettings,
  addRecentRecording,
  removeRecentRecording,
  clearRecentRecordings,
  generateFilename,
} = require("../utils/settings");
const { convertVideo } = require("../utils/ffmpeg");
const tray = require("./tray");
const shortcuts = require("./shortcuts");
const state = require("./state");

let mainWindow = null;
let ICON_PATH = null;

// Active chunked recording sessions: sessionId -> { ws, tempFilePath, size }
const chunkSessions = new Map();

function setMainWindowRef(window, iconPath) {
  mainWindow = window;
  ICON_PATH = iconPath;
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

async function saveRecording(streamData, chunkFiles = []) {
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
  log(
    "info",
    `Saving recording: format=${format}, defaultFormat=${settings.defaultFormat}, autoSave=${settings.autoSave}`,
  );
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
    log("info", `Auto-saving to: ${filePath}, ext=${path.extname(filePath)}`);
  } else {
    const defaultExt = format === "webm" ? "webm" : "mp4";
    const result = await dialog.showSaveDialog(mainWindow, {
      title: "Save Recording",
      defaultPath: path.join(outputDir, defaultName),
      filters: [
        { name: "MP4 Video", extensions: ["mp4"] },
        { name: "WebM Video (no conversion)", extensions: ["webm"] },
      ],
      properties: ["dontAddToRecent"],
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

    if (chunkFiles && chunkFiles.length > 0) {
      const allChunks = [];
      for (const chunkPath of chunkFiles) {
        if (fs.existsSync(chunkPath)) {
          const chunkData = fs.readFileSync(chunkPath);
          allChunks.push(chunkData);
          fs.unlinkSync(chunkPath);
        }
      }
      if (streamData && streamData.byteLength > 0) {
        allChunks.push(Buffer.from(new Uint8Array(streamData)));
      }
      fs.writeFileSync(tempFilePath, Buffer.concat(allChunks));
    } else {
      const buffer = Buffer.from(new Uint8Array(streamData));
      fs.writeFileSync(tempFilePath, buffer);
    }

    if (fs.existsSync(tempFilePath)) {
      const stats = fs.statSync(tempFilePath);
      log(
        "info",
        `Recording saved to temp: ${tempFilePath}, size: ${stats.size} bytes`,
      );
    }

    const ext = path.extname(filePath).toLowerCase();

    if (ext === ".mp4") {
      const convertedPath = filePath;

      log(
        "info",
        `Starting conversion: temp=${tempFilePath}, output=${convertedPath}, exists=${fs.existsSync(tempFilePath)}`,
      );

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

function setupIpcHandlers() {
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

  ipcMain.handle("save-recording", async (_, streamData, chunkFiles) => {
    return await saveRecording(streamData, chunkFiles);
  });

  // Chunked recording: create session, append chunks (via ipc send), finalize/abort
  ipcMain.handle("start-chunked-recording", async (_, options = {}) => {
    try {
      const tempDir = app.getPath("temp");
      const tempFilePath = path.join(
        tempDir,
        `chunked_${Date.now()}_${Math.random().toString(36).slice(2)}.webm`,
      );
      const ws = fs.createWriteStream(tempFilePath, { flags: "w" });
      const sessionId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
      chunkSessions.set(sessionId, { ws, tempFilePath, size: 0 });
      log("info", `Started chunked session ${sessionId} -> ${tempFilePath}`);
      return { sessionId, tempFilePath };
    } catch (err) {
      log("error", `start-chunked-recording failed: ${err.message}`);
      return { success: false, error: err.message };
    }
  });

  ipcMain.on("append-recording-chunk", (_, sessionId, uint8Array) => {
    try {
      if (!sessionId || !uint8Array) {
        log("warn", "append-recording-chunk received invalid message payload");
        return;
      }
      const sess = chunkSessions.get(sessionId);
      if (!sess) {
        log("warn", `append-recording-chunk: session not found ${sessionId}`);
        return;
      }
      const buf = Buffer.from(uint8Array); // Zero-copy Uint8Array to Node.js Buffer
      sess.ws.write(buf);
      sess.size = (sess.size || 0) + buf.length;
    } catch (err) {
      log("error", `append-recording-chunk failed: ${err.message}`);
    }
  });

  ipcMain.handle(
    "finalize-chunked-recording",
    async (_, sessionId, options = {}) => {
      try {
        const sess = chunkSessions.get(sessionId);
        if (!sess) {
          return { success: false, error: "Session not found" };
        }

        await new Promise((resolve, reject) => {
          sess.ws.end(() => resolve());
          sess.ws.on("error", reject);
        });

        const tempFilePath = sess.tempFilePath;
        chunkSessions.delete(sessionId);

        // Reuse save flow: prompt for save/convert depending on settings
        const settings = getSettings();
        const outputDir = settings.outputDirectory || app.getPath("videos");

        if (!fs.existsSync(outputDir)) {
          try {
            fs.mkdirSync(outputDir, { recursive: true });
          } catch (mkdirErr) {
            log(
              "error",
              `Failed to create output directory: ${mkdirErr.message}`,
            );
            return { success: false, error: "Cannot access output directory" };
          }
        }

        const format = settings.defaultFormat || "mp4";
        let filePath;
        let canceled = false;

        if (settings.autoSave) {
          const pattern = settings.filenamePattern || "Recording_{date}_{time}";
          const defaultName = generateFilename(pattern, format);
          filePath = path.join(outputDir, defaultName);
          let counter = 1;
          const basePath = filePath;
          while (fs.existsSync(filePath)) {
            const ext = path.extname(basePath);
            const name = path.basename(basePath, ext);
            filePath = path.join(outputDir, `${name}_${counter}${ext}`);
            counter++;
          }
        } else {
          const defaultName = generateFilename(
            settings.filenamePattern || "Recording_{date}_{time}",
            format,
          );
          const result = await dialog.showSaveDialog(mainWindow, {
            title: "Save Recording",
            defaultPath: path.join(outputDir, defaultName),
            filters: [
              { name: "MP4 Video", extensions: ["mp4"] },
              { name: "WebM Video (no conversion)", extensions: ["webm"] },
            ],
            properties: ["dontAddToRecent"],
          });
          filePath = result.filePath;
          canceled = result.canceled;
        }

        if (canceled || !filePath) {
          // Remove temp file
          try {
            if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
          } catch (e) { }
          return { success: false, canceled: true };
        }

        const ext = path.extname(filePath).toLowerCase();

        if (ext === ".mp4") {
          const convertedPath = filePath;
          mainWindow?.webContents.send("conversion-started");

          convertVideo(tempFilePath, convertedPath, (progress) => {
            mainWindow?.webContents.send("conversion-progress", progress);
          })
            .then(() => {
              try {
                if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
              } catch (e) { }
              log("info", `Recording converted and saved: ${convertedPath}`);
              mainWindow?.webContents.send(
                "conversion-complete",
                convertedPath,
              );
              addRecentRecording(convertedPath);
              showRecordingNotification(convertedPath);
            })
            .catch((convertErr) => {
              log(
                "error",
                `Conversion failed: ${convertErr.message}, saving as webm`,
              );
              const webmPath = filePath.replace(/\.mp4$/i, ".webm");
              try {
                fs.renameSync(tempFilePath, webmPath);
              } catch (e) { }
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
          try {
            fs.renameSync(tempFilePath, filePath);
            addRecentRecording(filePath);
            return { success: true, filePath };
          } catch (err) {
            log("error", `Failed to move temp file: ${err.message}`);
            return { success: false, error: err.message };
          }
        }
      } catch (err) {
        log("error", `finalize-chunked-recording failed: ${err.message}`);
        return { success: false, error: err.message };
      }
    },
  );

  ipcMain.handle("abort-chunked-recording", async (_, sessionId) => {
    try {
      const sess = chunkSessions.get(sessionId);
      if (sess) {
        try {
          sess.ws.destroy();
        } catch (e) { }
        try {
          if (fs.existsSync(sess.tempFilePath))
            fs.unlinkSync(sess.tempFilePath);
        } catch (e) { }
        chunkSessions.delete(sessionId);
      }
      return { success: true };
    } catch (err) {
      log("error", `abort-chunked-recording failed: ${err.message}`);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle("open-file-location", async (_, filePath) => {
    try {
      if (!filePath) {
        log("warn", "open-file-location: No file path provided");
        return { success: false, error: "No file path provided" };
      }
      openFileLocation(filePath);
      return { success: true };
    } catch (err) {
      log("error", `open-file-location failed: ${err.message}`);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle("open-file", async (_, filePath) => {
    try {
      if (!filePath) {
        log("warn", "open-file: No file path provided");
        return { success: false, error: "No file path provided" };
      }
      await openFile(filePath);
      return { success: true };
    } catch (err) {
      log("error", `open-file failed: ${err.message}`);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle("set-recording-state", (_, recording, isPaused = false) => {
    try {
      state.setRecordingState(recording);

      if (recording && !isPaused) {
        tray.createRecordingTray();
        const settings = getSettings();
        if (settings.hideWindowDuringRecording && mainWindow) {
          mainWindow.hide();
        }
      } else if (recording && isPaused) {
        tray.createPausedTray();
      } else {
        tray.restoreNormalTray();
        if (mainWindow && !mainWindow.isVisible()) {
          mainWindow.show();
          if (mainWindow.isMinimized()) {
            mainWindow.restore();
          }
          mainWindow.focus();
        }
      }
      return { success: true };
    } catch (err) {
      log("error", `set-recording-state failed: ${err.message}`);
      return { success: false, error: err.message };
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
      if (filePath && fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch (unlinkErr) {
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
      } catch (e) { }
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
      nvencPromptDismissed: Boolean(newSettings.nvencPromptDismissed),
      webcamEnabled: Boolean(newSettings.webcamEnabled),
      selectedCamera: newSettings.selectedCamera || "default",
      webcamPosition: [
        "top-left",
        "top-right",
        "bottom-left",
        "bottom-right",
      ].includes(newSettings.webcamPosition)
        ? newSettings.webcamPosition
        : "bottom-right",
      webcamSize: ["small", "medium", "large"].includes(newSettings.webcamSize)
        ? newSettings.webcamSize
        : "medium",
    };

    saveSettings(validatedSettings);
    shortcuts.registerGlobalShortcut();
    return getSettings();
  });

  ipcMain.handle("show-save-dialog", async (_, options) => {
    try {
      if (!mainWindow) {
        log("error", "show-save-dialog: Main window not available");
        return {
          canceled: true,
          filePath: null,
          error: "Main window not available",
        };
      }
      const result = await dialog.showSaveDialog(mainWindow, options);
      return result;
    } catch (err) {
      log("error", `show-save-dialog failed: ${err.message}`);
      return { canceled: true, filePath: null, error: err.message };
    }
  });

  ipcMain.handle("select-directory", async () => {
    try {
      if (!mainWindow) {
        log("error", "select-directory: Main window not available");
        return null;
      }
      const result = await dialog.showOpenDialog(mainWindow, {
        properties: ["openDirectory"],
        title: "Select Output Directory",
      });
      if (
        result.canceled ||
        !result.filePaths ||
        result.filePaths.length === 0
      ) {
        return null;
      }
      return result.filePaths[0];
    } catch (err) {
      log("error", `select-directory failed: ${err.message}`);
      return null;
    }
  });

  ipcMain.handle("get-app-paths", () => {
    return {
      temp: app.getPath("temp"),
      videos: app.getPath("videos"),
      documents: app.getPath("documents"),
    };
  });

  ipcMain.handle("get-displays", async () => {
    try {
      const { screen } = require("electron");
      const displays = screen.getAllDisplays();
      if (!displays || displays.length === 0) {
        log("warn", "get-displays: No displays found");
        return [];
      }
      const primaryDisplay = screen.getPrimaryDisplay();
      return displays.map((display) => ({
        id: display.id,
        bounds: display.bounds,
        workArea: display.workArea,
        scaleFactor: display.scaleFactor,
        isPrimary: display.id === primaryDisplay.id,
      }));
    } catch (err) {
      log("error", `get-displays failed: ${err.message}`);
      return [];
    }
  });

  ipcMain.handle("start-region-selection", async () => {
    try {
      const { screen, BrowserWindow } = require("electron");
      const primaryDisplay = screen.getPrimaryDisplay();
      if (!primaryDisplay) {
        log("error", "start-region-selection: No primary display found");
        return null;
      }
      const { width, height } = primaryDisplay.size;

      const regionWindow = new BrowserWindow({
        x: 0,
        y: 0,
        width: width,
        height: height,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        fullscreen: true,
        skipTaskbar: true,
        resizable: false,
        movable: false,
        hasShadow: false,
        webPreferences: {
          nodeIntegration: true,
          contextIsolation: false,
        },
      });

      regionWindow.on("closed", () => {
        log("info", "Region selection window closed");
      });

      regionWindow.on("error", (err) => {
        log("error", `Region selection window error: ${err.message}`);
      });

      regionWindow.loadFile(
        path.join(__dirname, "..", "renderer", "region-select.html"),
      );
      regionWindow.setIgnoreMouseEvents(false);

      return new Promise((resolve) => {
        const timeoutId = setTimeout(
          () => {
            log("warn", "Region selection timed out after 5 minutes");
            if (!regionWindow.isDestroyed()) {
              regionWindow.close();
            }
            resolve(null);
          },
          5 * 60 * 1000,
        );

        ipcMain.once("region-selected-result", (_, region) => {
          clearTimeout(timeoutId);
          if (!regionWindow.isDestroyed()) {
            regionWindow.close();
          }
          resolve(region);
        });

        ipcMain.once("region-cancelled-result", () => {
          clearTimeout(timeoutId);
          if (!regionWindow.isDestroyed()) {
            regionWindow.close();
          }
          resolve(null);
        });
      });
    } catch (err) {
      log("error", `start-region-selection failed: ${err.message}`);
      return null;
    }
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
}

module.exports = {
  setMainWindowRef,
  setupIpcHandlers,
};
