const {
  ipcMain,
  dialog,
  shell,
  desktopCapturer,
  app,
  Notification,
  BrowserWindow,
  screen,
  nativeImage,
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
const {
  convertVideo,
  trimVideo,
  generateThumbnail,
  exportToGif,
  mergeVideos,
} = require("../utils/ffmpeg");
const tray = require("./tray");
const shortcuts = require("./shortcuts");
const state = require("./state");
const { getVisibleWindowBounds } = require("../utils/windows");

let uiohook = null;
let uIOhook = null;
let uiohookListenerRegistered = false;

try {
  const uiohookModule = require("uiohook-napi");
  uIOhook = uiohookModule.uIOhook;
  // Keep reference to prevent garbage collection
  uiohook = uIOhook;
  log("info", "uiohook-napi loaded successfully");
} catch (e) {
  log("warn", "uiohook-napi not available, click highlights disabled: " + e.message);
}

let mainWindow = null;
let overlayWindow = null;
let miniControlsWindow = null;
let regionIndicatorWindow = null;
let cameraWindow = null;
let ICON_PATH = null;
let clickHighlightHookRunning = false;

function setupClickHighlightHook(enabled) {
  if (!uIOhook) {
    log("warn", "setupClickHighlightHook: uIOhook not available");
    return;
  }

  if (enabled && !clickHighlightHookRunning) {
    try {
      if (!uiohookListenerRegistered) {
        uIOhook.on("mousedown", (e) => {
          if (overlayWindow && !overlayWindow.isDestroyed()) {
            overlayWindow.webContents.send("global-click", {
              x: e.x,
              y: e.y,
              button: e.button
            });
          }
        });
        uiohookListenerRegistered = true;
      }
      uIOhook.start();
      clickHighlightHookRunning = true;
    } catch (err) {
      log("error", `Failed to start click highlight hook: ${err.message}`);
    }
  } else if (!enabled && clickHighlightHookRunning) {
    try {
      uIOhook.stop();
      clickHighlightHookRunning = false;
    } catch (err) {
      log("error", `Failed to stop click highlight hook: ${err.message}`);
    }
  }
}

// Active chunked recording sessions: sessionId -> { ws, tempFilePath, size }
const chunkSessions = new Map();

// ── Ghost session cleanup sweep ─────────────────────────────────────────────
// Runs every 5 minutes. Kills FFmpeg processes and removes temp files for
// sessions that have been idle for more than 10 minutes (likely zombie sessions
// caused by renderer crashes or unexpected IPC disconnects).
const GHOST_SESSION_TTL_MS = 10 * 60 * 1000;   // 10 minutes
const GHOST_SESSION_SWEEP_MS = 5 * 60 * 1000;   // 5 minutes

setInterval(() => {
  const now = Date.now();
  for (const [sid, sess] of chunkSessions) {
    const age = now - (sess.createdAt || now);
    const isFinalizing = sess.isFinalizing;
    if (!isFinalizing && age > GHOST_SESSION_TTL_MS) {
      log("warn", `Ghost session detected: ${sid} (age ${Math.round(age / 60000)}min). Cleaning up.`);
      try { if (sess.ffmpegProcess) sess.ffmpegProcess.kill("SIGKILL"); } catch (e) { }
      try { if (sess.ws) sess.ws.destroy(); } catch (e) { }
      try {
        if (sess.tempFilePath && fs.existsSync(sess.tempFilePath)) {
          fs.unlinkSync(sess.tempFilePath);
        }
      } catch (e) { }
      chunkSessions.delete(sid);
    }
  }
}, GHOST_SESSION_SWEEP_MS).unref(); // .unref() so this timer won't block app shutdown


async function generateThumbnailHelper(videoPath) {
  try {
    const thumbDir = path.join(app.getPath("userData"), "thumbnails");
    if (!fs.existsSync(thumbDir)) {
      fs.mkdirSync(thumbDir, { recursive: true });
    }
    const thumbPath = path.join(thumbDir, `thumb_${Date.now()}.png`);
    await generateThumbnail(videoPath, thumbPath);
    return thumbPath;
  } catch (err) {
    log("error", `Thumbnail generation failed: ${err.message}`);
    return null;
  }
}

function setMainWindowRef(window, iconPath) {
  mainWindow = window;
  ICON_PATH = iconPath;
}

function setOverlayWindowRef(win) {
  overlayWindow = win;
}

function setMiniControlsWindowRef(win) {
  miniControlsWindow = win;
}

function setCameraWindowRef(win) {
  cameraWindow = win;
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

// Keep track of the forwarding pulse
let forwardingPulseInterval = null;

async function saveRecording(streamData, chunkFiles = [], forceAutoSave = false) {
  const settings = getSettings();
  const tempDir = app.getPath("temp");
  const outputDir = settings.outputDirectory || app.getPath("videos");

  if (!streamData || streamData.byteLength === 0) {
    log("error", "No recording data to save");
    return { success: false, error: "No recording data available" };
  }

  const fsPromises = fs.promises;
  let dirExists = false;
  try { await fsPromises.access(outputDir); dirExists = true; } catch (e) { }

  if (!dirExists) {
    try {
      await fsPromises.mkdir(outputDir, { recursive: true });
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

  if (autoSave || forceAutoSave) {
    filePath = path.join(outputDir, defaultName);
    let counter = 1;
    const basePath = filePath;
    let fileExists = false;
    try { await fsPromises.access(filePath); fileExists = true; } catch (e) { }

    while (fileExists) {
      const ext = path.extname(basePath);
      const name = path.basename(basePath, ext);
      filePath = path.join(outputDir, `${name}_${counter}${ext}`);
      counter++;
      try { await fsPromises.access(filePath); fileExists = true; } catch (e) { fileExists = false; }
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
        let chunkExists = false;
        try { await fsPromises.access(chunkPath); chunkExists = true; } catch (e) { }
        if (chunkExists) {
          const chunkData = await fsPromises.readFile(chunkPath);
          allChunks.push(chunkData);
          await fsPromises.unlink(chunkPath);
        }
      }
      if (streamData && streamData.byteLength > 0) {
        allChunks.push(Buffer.from(new Uint8Array(streamData)));
      }
      if (allChunks.length > 0) {
        await fsPromises.writeFile(tempFilePath, Buffer.concat(allChunks));
      } else {
        log("error", "No data to stream into temporary file");
        return { success: false, error: "No data available in stream" };
      }
    } else {
      const buffer = Buffer.from(new Uint8Array(streamData));
      await fsPromises.writeFile(tempFilePath, buffer);
    }

    let tempExists = false;
    try { await fsPromises.access(tempFilePath); tempExists = true; } catch (e) { }
    if (tempExists) {
      const stats = await fsPromises.stat(tempFilePath);
      log(
        "info",
        `Recording saved to temp: ${tempFilePath}, size: ${stats.size} bytes`,
      );
    }

    const ext = path.extname(filePath).toLowerCase();

    if (ext === ".mp4") {
      const convertedPath = filePath;

      let convertedExists = false;
      try { await fsPromises.access(tempFilePath); convertedExists = true; } catch (e) { }
      log(
        "info",
        `Starting conversion: temp=${tempFilePath}, output=${convertedPath}, exists=${convertedExists}`,
      );

      mainWindow?.webContents.send("conversion-started");

      convertVideo(tempFilePath, convertedPath, (progress) => {
        mainWindow?.webContents.send("conversion-progress", progress);
      })
        .then(async () => {
          let tempStillExists = false;
          try { await fsPromises.access(tempFilePath); tempStillExists = true; } catch (e) { }
          if (tempStillExists) {
            await fsPromises.unlink(tempFilePath);
          }
          const thumbPath = await generateThumbnailHelper(convertedPath);
          addRecentRecording(convertedPath, thumbPath);
          log("info", `Recording converted and saved: ${convertedPath}`);
          mainWindow?.webContents.send("conversion-complete", convertedPath);
          showRecordingNotification(convertedPath);
        })
        .catch(async (convertErr) => {
          log(
            "error",
            `Conversion failed: ${convertErr.message}, saving as webm`,
          );
          const webmPath = filePath.replace(/\.mp4$/i, ".webm");
          try { await fsPromises.rename(tempFilePath, webmPath); } catch (e) { }
          const thumbPath = await generateThumbnailHelper(webmPath);
          addRecentRecording(webmPath, thumbPath);
          mainWindow?.webContents.send("conversion-complete", webmPath);
          showRecordingNotification(webmPath);
        });

      return {
        success: true,
        filePath: convertedPath,
        backgroundProcessing: true,
      };
    } else {
      await fsPromises.rename(tempFilePath, filePath);
      log("info", `Recording saved: ${filePath}`);

      const thumbPath = await generateThumbnailHelper(filePath);
      addRecentRecording(filePath, thumbPath);

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
    if (mainWindow && !mainWindow.isDestroyed()) {
      // Hide immediately for instant perceived closure
      mainWindow.hide();
      mainWindow.close();
    } else {
      app.quit();
    }
  });

  ipcMain.handle("window-is-maximized", () => {
    return mainWindow?.isMaximized() || false;
  });

  ipcMain.handle("get-capture-sources", async () => {
    return await getCaptureSources();
  });

  ipcMain.handle("save-recording", async (_, streamData, chunkFiles, options = {}) => {
    return await saveRecording(streamData, chunkFiles, options.forceAutoSave);
  });

  // Chunked recording: create session, append chunks (via ipc send), finalize/abort
  // Supports 3 tiers: (1) live FFmpeg MP4 pipe, (2) sw-encoder fallback, (3) WebM file fallback
  ipcMain.handle("start-chunked-recording", async (_, options = {}) => {
    try {
      const settings = getSettings();
      const useLivePipe =
        options.useLivePipe &&
        settings.recordDirectToMp4 !== false &&
        settings.defaultFormat === "mp4";

      const tempDir = app.getPath("temp");
      const sessionId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;

      if (useLivePipe) {
        const { spawn } = require("child_process");
        const ffmpegModule = require("../utils/ffmpeg");
        const ffmpegPath = ffmpegModule.getSystemFfmpegPath() || "ffmpeg";

        const hwAccel = settings.hardwareAcceleration || "none";
        const preferredCodec = settings.videoCodec || "libx264";
        const qualityMode = settings.qualityControl || "crf";
        const selectedCrf = settings.crfValue !== undefined ? settings.crfValue : 23;
        const selectedBitrate = (settings.videoBitrate || 5) + "M";
        const colorFmt = settings.colorFormat || "yuv420p";

        let v_codec = preferredCodec;
        let v_options = [];

        // Dynamic Hardware Encoder Selection
        try {
          const encoders = await ffmpegModule.getAvailableEncoders();
          if (hwAccel !== "none") {
            const isHevc = preferredCodec === "libx265";
            // Each branch checks encoder availability explicitly so "auto" can fall through the chain
            if (hwAccel === "nvenc" || (hwAccel === "auto" && encoders.nvenc?.h264)) {
              v_codec = isHevc && encoders.nvenc?.hevc ? "hevc_nvenc" : "h264_nvenc";
              v_options = ["-preset", "p4", "-rc", "vbr", "-cq", selectedCrf.toString()];
            } else if (hwAccel === "qsv" || (hwAccel === "auto" && encoders.qsv?.h264)) {
              v_codec = isHevc && encoders.qsv?.hevc ? "hevc_qsv" : "h264_qsv";
              v_options = ["-preset", "balanced", "-global_quality", selectedCrf.toString()];
            } else if (hwAccel === "amf" || (hwAccel === "auto" && encoders.amf?.h264)) {
              v_codec = isHevc && encoders.amf?.hevc ? "hevc_amf" : "h264_amf";
              v_options = ["-quality", "balanced", "-rc", "vbr_latency"];
            }
          }
        } catch (encErr) {
          log("warn", `Could not query encoders: ${encErr.message}`);
        }

        // Apply SW encoder settings if no HW encoder was selected
        if (v_codec === "libx264" || v_codec === "libx265") {
          v_options = ["-preset", "ultrafast", "-tune", "zerolatency"];
          if (qualityMode === "crf") {
            v_options.push("-crf", selectedCrf.toString());
          } else {
            v_options.push("-b:v", selectedBitrate, "-maxrate", selectedBitrate, "-bufsize", (parseInt(selectedBitrate) * 2) + "M");
          }
          if (v_codec === "libx265") v_options.push("-vtag", "hvc1");
        } else if (qualityMode === "vbr") {
          v_options.push("-b:v", selectedBitrate, "-maxrate", selectedBitrate);
        }

        // Resolve output path
        const outputDir = settings.outputDirectory || app.getPath("videos");
        if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
        const pattern = settings.filenamePattern || "Recording_{date}_{time}";
        let finalPath = path.join(outputDir, generateFilename(pattern, "mp4"));
        let counter = 1;
        while (fs.existsSync(finalPath)) {
          const ext = path.extname(finalPath);
          const name = path.basename(finalPath, ext);
          finalPath = path.join(outputDir, `${name}_${counter}${ext}`);
          counter++;
        }

        log("info", `Starting live FFmpeg pipe (${v_codec}) -> ${finalPath}`);

        const args = [
          "-loglevel", "error",
          "-thread_queue_size", "8192",
          "-probesize", "10M",
          "-analyzeduration", "10M",
          "-fflags", "+genpts+discardcorrupt+nobuffer",
          "-threads", "2",
          "-f", "webm",
          "-i", "pipe:0",
          "-c:v", v_codec,
          ...v_options,
          "-r", String(settings.frameRate || 24),
          "-c:a", "aac",
          "-b:a", "128k",
          "-pix_fmt", colorFmt,
          "-movflags", "+frag_keyframe+empty_moov+default_base_moof",
          "-flush_packets", "1",
          "-y",
          finalPath
        ];

        let ffmpegProcess = spawn(ffmpegPath, args);
        let hasFailedPrematurely = false;

        const setupHandlers = (proc, isFallback = false) => {
          proc.stdin.on("error", (err) => {
            if (!hasFailedPrematurely) log("warn", `FFmpeg stdin error: ${err.message}`);
          });

          proc.stderr.on("data", (data) => {
            const msg = data.toString();
            if (hasFailedPrematurely && !isFallback) return;
            log("warn", `FFmpeg stderr: ${msg}`);

            // Hardware encoder or EBML parse failure → retry with software
            if (
              !hasFailedPrematurely &&
              !v_codec.startsWith("libx") &&
              (msg.includes("Driver does not support") ||
                msg.includes("Error while opening encoder") ||
                msg.includes("EBML header parsing failed"))
            ) {
              hasFailedPrematurely = true;
              log("info", "HW encoder failed, retrying with libx264...");
              try { proc.kill(); } catch (e) { }

              // Rebuild SW args from scratch to avoid HW arg mutation bugs
              const swArgs = [
                "-loglevel", "error",
                "-thread_queue_size", "8192",
                "-probesize", "10M",
                "-analyzeduration", "10M",
                "-fflags", "+genpts+discardcorrupt+nobuffer",
                "-threads", "2",
                "-f", "webm",
                "-i", "pipe:0",
                "-c:v", "libx264",
                "-preset", "ultrafast", "-tune", "zerolatency",
                "-crf", selectedCrf.toString(),
                "-r", String(settings.frameRate || 24),
                "-c:a", "aac",
                "-b:a", "128k",
                "-pix_fmt", "yuv420p",
                "-movflags", "+frag_keyframe+empty_moov+default_base_moof",
                "-flush_packets", "1",
                "-y", finalPath
              ];
              ffmpegProcess = spawn(ffmpegPath, swArgs);
              setupHandlers(ffmpegProcess, true);

              const sessFallback = chunkSessions.get(sessionId);
              if (sessFallback) {
                sessFallback.ffmpegProcess = ffmpegProcess;
                if (sessFallback.initialBuffer) {
                  for (const chunk of sessFallback.initialBuffer) {
                    if (ffmpegProcess.stdin.writable) ffmpegProcess.stdin.write(chunk);
                  }
                  sessFallback.initialBuffer = null;
                }
              }
            }
          });

          proc.on("close", (code) => {
            if (hasFailedPrematurely) return;
            const sess = chunkSessions.get(sessionId);
            if (sess && !sess.isFinalizing && code !== 0) {
              // Tier 3: FFmpeg crashed entirely – dump remaining data to WebM
              log("error", `FFmpeg crashed (code ${code}). Falling back to WebM file.`);
              sess.isLive = false;
              sess.ffmpegProcess = null;
              sess.tempFilePath = path.join(tempDir, `chunked_${Date.now()}_fallback.webm`);
              sess.ws = fs.createWriteStream(sess.tempFilePath, { flags: "w" });
              sess.ws.on("error", (e) => log("error", `Tier-3 fallback ws error: ${e.message}`));
              // Replay buffered chunks only after the stream confirms it is open
              sess.ws.once("open", () => {
                if (sess.initialBuffer) {
                  sess.initialBuffer.forEach(c => sess.ws.write(c));
                  sess.initialBuffer = null;
                }
                if (sess.writeQueue) {
                  sess.writeQueue.forEach(c => sess.ws.write(c));
                  sess.writeQueue = [];
                }
              });
              if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send("conversion-started");
                mainWindow.webContents.send("conversion-progress", {
                  percent: 10,
                  stage: "recovering",
                  status: "MP4 encoder failed. Saving as WebM instead..."
                });
              }
            } else {
              log("info", `FFmpeg pipe closed with code ${code}`);
            }
          });
        };

        setupHandlers(ffmpegProcess);

        chunkSessions.set(sessionId, {
          ffmpegProcess,
          finalPath,
          isLive: true,
          size: 0,
          createdAt: Date.now(),
          isFinalizing: false,
          initialBuffer: [],
          writeQueue: [],
          isWaitingForDrain: false,
          mimeType: options.mimeType || "",
        });

        return { sessionId, isLive: true, filePath: finalPath };
      }

      // Default: simple WebM temp file
      const tempFilePath = path.join(
        tempDir,
        `chunked_${Date.now()}_${Math.random().toString(36).slice(2)}.webm`
      );
      const ws = fs.createWriteStream(tempFilePath, { flags: "w" });
      chunkSessions.set(sessionId, { ws, tempFilePath, size: 0, isLive: false, createdAt: Date.now() });
      log("info", `Started WebM chunked session ${sessionId} -> ${tempFilePath}`);
      return { sessionId, tempFilePath, isLive: false };
    } catch (err) {
      log("error", `start-chunked-recording failed: ${err.message}`);
      return { success: false, error: err.message };
    }
  });

  ipcMain.on("append-recording-chunk", (_, sessionId, uint8Array) => {
    try {
      if (!sessionId || !uint8Array) return;
      const sess = chunkSessions.get(sessionId);
      if (!sess) return;

      const buf = Buffer.from(uint8Array.buffer, uint8Array.byteOffset, uint8Array.byteLength);

      if (sess.isLive && sess.ffmpegProcess) {
        if (sess.isFinalizing) return;

        // Keep the first 40 chunks (~4 s) for HW-encoder tier-2 recovery replay
        if (sess.initialBuffer && sess.initialBuffer.length < 40) {
          sess.initialBuffer.push(buf);
        }

        // Backpressure-aware queue
        sess.writeQueue.push(buf);
        const processQueue = () => {
          if (!sess.ffmpegProcess?.stdin?.writable) return;
          while (sess.writeQueue.length > 0 && !sess.isWaitingForDrain) {
            const data = sess.writeQueue.shift();
            const canWrite = sess.ffmpegProcess.stdin.write(data);
            if (!canWrite) {
              sess.isWaitingForDrain = true;
              sess.ffmpegProcess.stdin.once("drain", () => {
                sess.isWaitingForDrain = false;
                processQueue();
              });
              break;
            }
          }
        };
        processQueue();
      } else if (sess.ws) {
        sess.ws.write(buf);
      }

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
        if (!sess) return { success: false, error: "Session not found" };

        // ── Live FFmpeg path ──────────────────────────────────────────────
        if (sess.isLive) {
          log("info", `Finalizing live FFmpeg session ${sessionId}`);
          sess.isFinalizing = true;

          (async () => {
            // Drain remaining write queue
            const initialQueueSize = sess.writeQueue ? sess.writeQueue.length : 0;
            let lastQueueSize = initialQueueSize;
            let stalledCycles = 0;

            while (
              sess.writeQueue &&
              (sess.writeQueue.length > 0 || sess.isWaitingForDrain) &&
              stalledCycles < 500
            ) {
              if (initialQueueSize > 5) {
                const percent = Math.min(
                  99,
                  Math.round(((initialQueueSize - sess.writeQueue.length) / initialQueueSize) * 100)
                );
                if (mainWindow && !mainWindow.isDestroyed()) {
                  mainWindow.webContents.send("conversion-progress", {
                    percent,
                    stage: "finalizing",
                    status: `Flushing ${sess.writeQueue.length} remaining chunks...`
                  });
                }
              }
              await new Promise(r => setTimeout(r, 50));
              if (sess.writeQueue.length === lastQueueSize && !sess.isWaitingForDrain) {
                stalledCycles++;
              } else {
                stalledCycles = 0;
                lastQueueSize = sess.writeQueue.length;
              }
              if (sess.ffmpegProcess && sess.ffmpegProcess.exitCode !== null) break;
            }

            // Close FFmpeg stdin
            await new Promise(resolve => {
              if (sess.ffmpegProcess?.stdin?.writable) {
                sess.ffmpegProcess.stdin.end(() => resolve());
              } else {
                resolve();
              }
            });

            // Wait for FFmpeg to fully exit and capture exit code
            const ffmpegExitCode = await new Promise(resolve => {
              if (!sess.ffmpegProcess || sess.ffmpegProcess.exitCode !== null)
                return resolve(sess.ffmpegProcess?.exitCode ?? 0);
              sess.ffmpegProcess.on("close", (code) => resolve(code));
              setTimeout(() => resolve(-1), 10000);
            });

            const finalPath = sess.finalPath;
            const { spawn: spawnDefrag } = require("child_process");
            const defragFfmpegPath = require("../utils/ffmpeg").getSystemFfmpegPath() || "ffmpeg";
            chunkSessions.delete(sessionId);

            // Defragment fMP4 → standard MP4 with +faststart for better seeking & player compat
            if (ffmpegExitCode === 0 && fs.existsSync(finalPath)) {
              const defragPath = finalPath + ".defrag.mp4";
              try {
                await new Promise((res, rej) => {
                  const dp = spawnDefrag(defragFfmpegPath, [
                    "-loglevel", "error",
                    "-i", finalPath,
                    "-c", "copy",
                    "-movflags", "+faststart",
                    "-y", defragPath
                  ]);
                  dp.on("close", (c) => (c === 0 ? res() : rej(new Error(`defrag exit ${c}`))));
                  dp.on("error", rej);
                });
                fs.renameSync(defragPath, finalPath);
                log("info", `fMP4 faststart applied: ${finalPath}`);
              } catch (defragErr) {
                log("warn", `fMP4 defrag skipped (file still usable): ${defragErr.message}`);
                try { if (fs.existsSync(defragPath)) fs.unlinkSync(defragPath); } catch (_) { }
              }
            }

            const thumbPath = await generateThumbnailHelper(finalPath);
            addRecentRecording(finalPath, thumbPath);
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send("settings-updated", getSettings());
              mainWindow.webContents.send("conversion-complete", finalPath);
            }
            showRecordingNotification(finalPath);
          })();

          // Immediately add a placeholder to history
          addRecentRecording(sess.finalPath, null);
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send("settings-updated", getSettings());
          }

          const hasBacklog = (sess.writeQueue && sess.writeQueue.length > 3) || sess.isWaitingForDrain;
          if (hasBacklog && mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send("conversion-started");
          }

          return {
            success: true,
            filePath: sess.finalPath,
            backgroundProcessing: hasBacklog
          };
        }

        // ── WebM file path ─────────────────────────────────────────────────
        await new Promise((resolve, reject) => {
          sess.ws.end(() => resolve());
          sess.ws.on("error", reject);
        });

        const tempFilePath = sess.tempFilePath;
        chunkSessions.delete(sessionId);

        const settings = getSettings();
        const outputDir = settings.outputDirectory || app.getPath("videos");
        if (!fs.existsSync(outputDir)) {
          try { fs.mkdirSync(outputDir, { recursive: true }); }
          catch (e) { return { success: false, error: "Cannot access output directory" }; }
        }

        const format = settings.defaultFormat || "mp4";
        let filePath;
        let canceled = false;

        if (settings.autoSave || options.forceAutoSave) {
          const defaultName = generateFilename(settings.filenamePattern || "Recording_{date}_{time}", format);
          filePath = path.join(outputDir, defaultName);
          let counter = 1;
          const base = filePath;
          while (fs.existsSync(filePath)) {
            filePath = path.join(outputDir, `${path.basename(base, path.extname(base))}_${counter}${path.extname(base)}`);
            counter++;
          }
        } else {
          const defaultName = generateFilename(settings.filenamePattern || "Recording_{date}_{time}", format);
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
          try { if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath); } catch (e) { }
          return { success: false, canceled: true };
        }

        const ext = path.extname(filePath).toLowerCase();
        if (ext === ".mp4") {
          const convertedPath = filePath;
          mainWindow?.webContents.send("conversion-started");
          convertVideo(tempFilePath, convertedPath, (progress) => {
            mainWindow?.webContents.send("conversion-progress", progress);
          })
            .then(async () => {
              try { if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath); } catch (e) { }
              const thumbPath = await generateThumbnailHelper(convertedPath);
              addRecentRecording(convertedPath, thumbPath);
              mainWindow?.webContents.send("conversion-complete", convertedPath);
              showRecordingNotification(convertedPath);
            })
            .catch(async (convertErr) => {
              log("error", `Conversion failed: ${convertErr.message}, saving as webm`);
              const webmPath = filePath.replace(/\.mp4$/i, ".webm");
              try { fs.renameSync(tempFilePath, webmPath); } catch (e) { }
              const thumbPath = await generateThumbnailHelper(webmPath);
              addRecentRecording(webmPath, thumbPath);
              mainWindow?.webContents.send("conversion-complete", webmPath);
              showRecordingNotification(webmPath);
            });
          return { success: true, filePath: convertedPath, backgroundProcessing: true };
        } else {
          try {
            fs.renameSync(tempFilePath, filePath);
            const thumbPath = await generateThumbnailHelper(filePath);
            addRecentRecording(filePath, thumbPath);
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
        if (sess.isLive && sess.ffmpegProcess) {
          try { sess.ffmpegProcess.kill("SIGKILL"); } catch (e) { }
          try { if (sess.finalPath && fs.existsSync(sess.finalPath)) fs.unlinkSync(sess.finalPath); } catch (e) { }
        } else {
          try { sess.ws.destroy(); } catch (e) { }
          try { if (fs.existsSync(sess.tempFilePath)) fs.unlinkSync(sess.tempFilePath); } catch (e) { }
        }
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

  ipcMain.handle("trim-video", async (_, filePath, startTime, endTime) => {
    try {
      const result = await trimVideo(filePath, startTime, endTime);
      if (result.success) {
        const thumbPath = await generateThumbnailHelper(result.outputPath);
        addRecentRecording(result.outputPath, thumbPath);
        return { success: true, outputPath: result.outputPath };
      }
      return { success: false, error: "Trimming failed" };
    } catch (err) {
      log("error", `Trim IPC error: ${err.message}`);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle("trim-to-gif", async (_, filePath, startTime, endTime) => {
    try {
      mainWindow?.webContents.send("conversion-started");
      const result = await exportToGif(
        filePath,
        startTime,
        endTime,
        (progress) => {
          mainWindow?.webContents.send("conversion-progress", {
            percent: progress,
            stage: "Generating GIF...",
          });
        },
      );
      if (result.success) {
        mainWindow?.webContents.send("conversion-complete", result.outputPath);
        return { success: true, outputPath: result.outputPath };
      }
      return { success: false, error: "GIF export failed" };
    } catch (err) {
      log("error", `GIF IPC error: ${err.message}`);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle("merge-videos", async (_, filePaths) => {
    try {
      if (!filePaths || filePaths.length < 2) {
        return { success: false, error: "Need at least 2 videos to merge" };
      }

      mainWindow?.webContents.send("conversion-started");

      const settings = getSettings();
      const outputDir = settings.outputDirectory || app.getPath("videos");
      const fileName = `Merged_${Date.now()}.mp4`;
      const outputPath = path.join(outputDir, fileName);

      const result = await mergeVideos(filePaths, outputPath, (progress) => {
        mainWindow?.webContents.send("conversion-progress", {
          percent: progress,
          stage: "Merging videos...",
        });
      });

      if (result.success) {
        const thumbPath = await generateThumbnailHelper(result.outputPath);
        addRecentRecording(result.outputPath, thumbPath);
        mainWindow?.webContents.send("conversion-complete", result.outputPath);
        return { success: true, outputPath: result.outputPath };
      }
      return { success: false, error: "Merging failed" };
    } catch (err) {
      log("error", `Merge IPC error: ${err.message}`);
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

  ipcMain.handle("add-recent-recording", async (_, filePath) => {
    const thumbPath = await generateThumbnailHelper(filePath);
    addRecentRecording(filePath, thumbPath);
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
      resolution: ["native", "1280x720", "1920x1080", "2560x1440", "3840x2160"].includes(
        newSettings.resolution,
      )
        ? newSettings.resolution
        : "native",
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
      recordDirectToMp4: newSettings.recordDirectToMp4 !== false,
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
      videoCodec: ["libx264", "libx265"].includes(newSettings.videoCodec)
        ? newSettings.videoCodec
        : "libx264",
      qualityControl: ["crf", "vbr"].includes(newSettings.qualityControl)
        ? newSettings.qualityControl
        : "crf",
      crfValue: Number.isInteger(newSettings.crfValue) && newSettings.crfValue >= 0 && newSettings.crfValue <= 51
        ? newSettings.crfValue
        : 23,
      videoBitrate: Number.isInteger(newSettings.videoBitrate) && newSettings.videoBitrate >= 1 && newSettings.videoBitrate <= 50
        ? newSettings.videoBitrate
        : 5,
      colorFormat: ["yuv420p", "yuv444p"].includes(newSettings.colorFormat)
        ? newSettings.colorFormat
        : "yuv420p",
      showMiniControls: Boolean(newSettings.showMiniControls),
      showClickHighlights: Boolean(newSettings.showClickHighlights),
      highlightLeftColor: typeof newSettings.highlightLeftColor === 'string' ? newSettings.highlightLeftColor : '#FFEB3B',
      highlightRightColor: typeof newSettings.highlightRightColor === 'string' ? newSettings.highlightRightColor : '#2196F3',
      highlightRippleSize: Number.isInteger(newSettings.highlightRippleSize) ? newSettings.highlightRippleSize : 50,
      highlightRippleSpeed: Number.isInteger(newSettings.highlightRippleSpeed) ? newSettings.highlightRippleSpeed : 400,
      highlightGlowSize: Number.isInteger(newSettings.highlightGlowSize) ? newSettings.highlightGlowSize : 25,
      highlightGlowIntensity: Number.isInteger(newSettings.highlightGlowIntensity) ? newSettings.highlightGlowIntensity : 30,
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

  // ── Region Selection Persistence ───────────────────────────
  let pendingRegionSelection = null;

  ipcMain.handle("start-region-selection", async () => {
    if (pendingRegionSelection) {
      log("warn", "Start-region-selection: Already in progress");
      return null;
    }

    // Hide existing indicator if drawing a new region
    if (regionIndicatorWindow && !regionIndicatorWindow.isDestroyed()) {
      regionIndicatorWindow.hide();
    }

    let regionWindow = null;
    try {
      const primaryDisplay = screen.getPrimaryDisplay();
      if (!primaryDisplay) {
        log("error", "start-region-selection: No primary display found");
        return null;
      }

      const { x, y, width, height } = primaryDisplay.bounds;
      const scaleFactor = primaryDisplay.scaleFactor || 1;
      const lastRegion = getSettings().lastRegion || null;

      regionWindow = new BrowserWindow({
        x: Math.round(x),
        y: Math.round(y),
        width: Math.round(width),
        height: Math.round(height),
        frame: false,
        transparent: true,
        skipTaskbar: true,
        resizable: false,
        movable: false,
        hasShadow: false,
        show: false,
        focusable: true,
        enableLargerThanScreen: true,
        thickFrame: false,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          preload: path.join(__dirname, "..", "preload", "preload.js"),
        },
      });

      regionWindow.loadFile(
        path.join(__dirname, "..", "renderer", "region-select.html"),
      );

      const windowBoundsPromise = getVisibleWindowBounds();

      regionWindow.webContents.once("did-finish-load", async () => {
        if (regionWindow && !regionWindow.isDestroyed()) {
          // On Windows, setFullScreen is the most reliable way to cover the taskbar
          regionWindow.setFullScreen(true);
          regionWindow.show();

          // Force above everything including taskbar with a higher priority (1)
          regionWindow.setAlwaysOnTop(true, "screen-saver", 1);
          regionWindow.moveTop();

          // Prevent the selection UI itself from being captured if recording starts early
          regionWindow.setContentProtection(true);

          // Send initial data immediately
          regionWindow.webContents.send("region-init", {
            scaleFactor,
            screenshot: null,
            lastRegion,
            monitorX: x,
            monitorY: y,
            windows: [], // Start empty, will update soon
          });

          regionWindow.focus();

          // Fetch windows asynchronously to not block the UI
          windowBoundsPromise.then(windows => {
            if (regionWindow && !regionWindow.isDestroyed()) {
              console.log(`[IPC] Asynchronously sending ${windows.length} window bounds to renderer`);
              regionWindow.webContents.send("windows-update", windows);
            }
          });
        }
      });

      return (pendingRegionSelection = new Promise((resolve) => {
        let isFinalized = false;

        const finalize = (result = null) => {
          if (isFinalized) return;
          isFinalized = true;
          pendingRegionSelection = null;

          log("info", `Finalizing selection. Result: ${result ? "Region" : "None"}`);

          // Remove listeners
          ipcMain.removeListener("region-selected", onSelected);
          ipcMain.removeListener("region-cancelled", onCancelled);

          if (regionWindow && !regionWindow.isDestroyed()) {
            try {
              regionWindow.hide();
              log("info", "Region window hidden");

              // Resolve BEFORE destroying to avoid blocking the main thread
              resolve(result);

              // Use setImmediate to let the current turn of the event loop finish
              setImmediate(() => {
                if (regionWindow && !regionWindow.isDestroyed()) {
                  regionWindow.destroy();
                  log("info", "Region window destroyed");
                }
              });
            } catch (err) {
              log("error", `Error during window cleanup: ${err.message}`);
              resolve(result);
            }
          } else {
            resolve(result);
          }
        };

        const onSelected = (_, region) => {
          if (region) {
            try {
              const current = getSettings();
              saveSettings({ ...current, lastRegion: region });
            } catch (e) { }
          }
          finalize(region);
        };

        const onCancelled = () => {
          finalize(null);
        };

        ipcMain.once("region-selected", onSelected);
        ipcMain.once("region-cancelled", onCancelled);

        regionWindow.once("closed", () => finalize(null));
      }));
    } catch (err) {
      log("error", `start-region-selection error: ${err.message}`);
      if (regionWindow && !regionWindow.isDestroyed()) regionWindow.destroy();
      pendingRegionSelection = null;
      return null;
    }
  });


  ipcMain.handle("get-available-encoders", async () => {
    try {
      const ffmpegUtil = require("../utils/ffmpeg");
      const { getAvailableEncoders, getSystemFfmpegPath } =
        ffmpegUtil;
      const enc = await getAvailableEncoders();
      const systemPath = getSystemFfmpegPath();
      return { encoders: enc, systemFfmpeg: systemPath };
    } catch (err) {
      log("error", `Failed to get available encoders: ${err.message}`);
      return { nvenc: false, qsv: false, amf: false };
    }
  });

  let overlayMoveTopInterval = null;

  // ── Overlay window IPC handlers ──────────────────────────────────────────

  // Show the overlay spanning the specified display (or primary if not specified)
  ipcMain.handle("overlay-show", (_, displayId) => {
    const ov = overlayWindow;
    if (!ov) return;

    const { screen } = require("electron");
    let targetDisplay = screen.getPrimaryDisplay();

    if (displayId !== undefined && displayId !== null) {
      const allDisplays = screen.getAllDisplays();
      targetDisplay = allDisplays.find(d => d.id === displayId) || screen.getPrimaryDisplay();
    }

    const bounds = targetDisplay.bounds;

    ov.setPosition(bounds.x, bounds.y);
    ov.setSize(bounds.width, bounds.height);
    ov.show();
    ov.setAlwaysOnTop(true, "screen-saver");
    ov.moveTop();

    // Send display offset to overlay for coordinate conversion
    if (ov.webContents) {
      ov.webContents.send("overlay-display-offset", { x: bounds.x, y: bounds.y });
    }

    log("info", `Overlay shown on display ${targetDisplay.id} at (${bounds.x}, ${bounds.y})`);
  });

  // Hide the overlay
  ipcMain.handle("overlay-hide", () => {
    const ov = overlayWindow;
    if (!ov) return;
    if (overlayMoveTopInterval) {
      clearInterval(overlayMoveTopInterval);
      overlayMoveTopInterval = null;
    }
    ov.hide();
    log("info", "Overlay window hidden");
  });

  // Toggle draw mode: when true the overlay captures mouse events so the user can draw
  ipcMain.on("overlay-draw-mode", (event, enabled) => {
    const ov = overlayWindow;
    if (!ov) return;

    if (enabled) {
      // Bring overlay to front and ensure it covers the taskbar
      ov.setIgnoreMouseEvents(false);
      ov.setAlwaysOnTop(true, "screen-saver");
      ov.moveTop();

      // Ensure the main window stays above the overlay so tools can be clicked
      if (mainWindow && mainWindow.isVisible()) {
        mainWindow.setAlwaysOnTop(true, "screen-saver");
        mainWindow.focus();
      }

      ov.setFocusable(false);

      // Periodically re-assert overlay position above the Windows taskbar
      if (overlayMoveTopInterval) clearInterval(overlayMoveTopInterval);
      overlayMoveTopInterval = setInterval(() => {
        if (overlayWindow && !overlayWindow.isDestroyed()) {
          overlayWindow.moveTop();
          if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
            mainWindow.moveTop();
          }
        } else {
          clearInterval(overlayMoveTopInterval);
          overlayMoveTopInterval = null;
        }
      }, 500);
    } else {
      // Stop the periodic re-assertion
      if (overlayMoveTopInterval) {
        clearInterval(overlayMoveTopInterval);
        overlayMoveTopInterval = null;
      }

      ov.setIgnoreMouseEvents(true, { forward: true });
      ov.setAlwaysOnTop(true, "status");
      ov.setFocusable(false);
      if (mainWindow) {
        // Reset main window's alwaysOnTop state
        mainWindow.setAlwaysOnTop(false);
        mainWindow.focus();
      }
    }

    if (ov.webContents) {
      ov.webContents.send("overlay-draw-mode", enabled);
    }
  });

  // ── Region Indicator Handlers ──────────────────────────────────────────

  ipcMain.on("region-indicator-show", (event, region) => {
    if (!region) return;

    if (!regionIndicatorWindow || regionIndicatorWindow.isDestroyed()) {
      const primaryDisplay = screen.getPrimaryDisplay();
      const { x, y, width, height } = primaryDisplay.bounds;

      regionIndicatorWindow = new BrowserWindow({
        x: Math.round(x),
        y: Math.round(y),
        width: Math.round(width),
        height: Math.round(height),
        frame: false,
        transparent: true,
        skipTaskbar: true,
        resizable: false,
        movable: false,
        hasShadow: false,
        focusable: false,
        show: false,
        enableLargerThanScreen: true,
        thickFrame: false,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          preload: path.join(__dirname, "..", "preload", "preload.js"),
        },
      });

      regionIndicatorWindow.setIgnoreMouseEvents(true);
      // Use setFullScreen to definitively cover the taskbar
      regionIndicatorWindow.setFullScreen(true);
      // Use higher alwaysOnTop priority
      regionIndicatorWindow.setAlwaysOnTop(true, "screen-saver", 1);
      // CRITICAL: Prevent the red border from being recorded in the output video
      regionIndicatorWindow.setContentProtection(true);

      regionIndicatorWindow.loadFile(
        path.join(__dirname, "..", "renderer", "region-indicator.html")
      );
    }

    regionIndicatorWindow.webContents.once("did-finish-load", () => {
      if (regionIndicatorWindow && !regionIndicatorWindow.isDestroyed()) {
        regionIndicatorWindow.showInactive();
        regionIndicatorWindow.webContents.send("region-update", region);
      }
    });

    // Always send the region update to ensure it's fresh when shown
    regionIndicatorWindow.webContents.send("region-update", region);

    if (!regionIndicatorWindow.isVisible()) {
      regionIndicatorWindow.showInactive();
    }
  });

  ipcMain.on("region-indicator-hide", () => {
    if (regionIndicatorWindow && !regionIndicatorWindow.isDestroyed()) {
      regionIndicatorWindow.hide();
    }
  });

  // When overlay renderer toggles mouse capture itself (e.g. hold-to-draw key)
  ipcMain.on("overlay-set-mouse-capture", (_, capture) => {
    const ov = overlayWindow;
    if (!ov) return;
    if (capture) {
      ov.setIgnoreMouseEvents(false);
      ov.setAlwaysOnTop(true, "screen-saver");
      if (mainWindow && mainWindow.isVisible()) {
        mainWindow.setAlwaysOnTop(true, "screen-saver");
        mainWindow.focus();
      }
      ov.setFocusable(false);
    } else {
      ov.setIgnoreMouseEvents(true, { forward: true });
      ov.setAlwaysOnTop(true, "status");
      ov.setFocusable(false);
      if (mainWindow) {
        mainWindow.setAlwaysOnTop(false);
        mainWindow.focus();
      }
    }
  });

  // Temporarily toggle overlay OS-level focusability for text inputs
  ipcMain.on("overlay-set-focusable", (_, focusable) => {
    const ov = overlayWindow;
    if (ov) {
      ov.setFocusable(focusable);
      if (focusable) {
        ov.focus();
      } else {
        // Re-assert overlay position above taskbar after losing focus
        ov.setAlwaysOnTop(true, "screen-saver");
        ov.moveTop();
        if (mainWindow) {
          mainWindow.setAlwaysOnTop(true, "screen-saver");
          mainWindow.moveTop();
        }
      }
    }
  });

  // Relay tool / color / width from the main UI into overlay
  ipcMain.on("overlay-settings-from-main", (_, settings) => {
    const ov = overlayWindow;
    if (ov) ov.webContents.send("overlay-settings", settings);
  });

  // Relay undo / clear commands into overlay
  ipcMain.on("overlay-command-from-main", (_, cmd) => {
    const ov = overlayWindow;
    if (ov) ov.webContents.send("overlay-command", cmd);
  });

  // Relay drawing actions from overlay back to main window (recorder)
  ipcMain.on("overlay-action", (_, action) => {
    if (mainWindow) mainWindow.webContents.send("overlay-action", action);
  });
  // ── Mini Controls Relay ───────────────────────────────────────────────────
  // Relay recording timer to mini window
  ipcMain.on("recording-timer-update", (_, timeStr) => {
    if (miniControlsWindow && !miniControlsWindow.isDestroyed()) {
      miniControlsWindow.webContents.send("mini-timer-update", timeStr);
    }
  });

  // Relay command from mini window to main window
  ipcMain.on("mini-command", (_, data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      // Execute command in main window context
      if (data.action === "close-mini") {
        if (miniControlsWindow) miniControlsWindow.hide();
      } else {
        mainWindow.webContents.send("mini-command", data);
      }
    }
  });

  // We add to set-recording-state to keep mini window in sync
  ipcMain.handle("set-recording-state", async (_, recording, isPaused = false) => {
    try {
      state.setRecordingState(recording);
      state.setPaused(isPaused);

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

      // Show/Hide Mini Controls
      if (miniControlsWindow && !miniControlsWindow.isDestroyed()) {
        const settings = getSettings();
        if (recording && settings.showMiniControls) {
          miniControlsWindow.show();
          miniControlsWindow.setAlwaysOnTop(true, "screen-saver");

          // Re-assert protection upon show for extra reliability
          if (process.platform === "win32") {
            if (typeof miniControlsWindow.setExcludeFromCapture === "function") {
              miniControlsWindow.setExcludeFromCapture(true);
            }
            if (typeof miniControlsWindow.setContentProtection === "function") {
              miniControlsWindow.setContentProtection(true);
            }
          }
        } else {
          miniControlsWindow.hide();
        }

        // Sync settings/state to mini window
        miniControlsWindow.webContents.send("mini-state-update", {
          isPaused,
          isRecording: recording,
          recordAudio: getSettings().recordAudio,
          isDrawingActive: overlayWindow ? overlayWindow.isVisible() : false,
        });
      }

      // Show/Hide Overlay for highlights
      if (overlayWindow && !overlayWindow.isDestroyed()) {
        const settings = getSettings();
        if (recording && settings.showClickHighlights) {
          // Start global click hook for capturing mouse clicks
          setupClickHighlightHook(true);

          const { screen } = require("electron");
          const primaryDisplay = screen.getPrimaryDisplay();
          const bounds = primaryDisplay.bounds;

          overlayWindow.setPosition(bounds.x, bounds.y);
          overlayWindow.setSize(bounds.width, bounds.height);

          // Forward clicks to windows below so they're captured in recording
          // Note: This means we can't capture clicks via DOM events
          // We'll rely on uiohook for global click detection
          overlayWindow.setIgnoreMouseEvents(true, { forward: true });

          overlayWindow.showInactive();
          overlayWindow.setAlwaysOnTop(true, "screen-saver");

          // Start a pulse to keep Windows from "forgetting" our forwarding flag
          if (forwardingPulseInterval) clearInterval(forwardingPulseInterval);
          forwardingPulseInterval = setInterval(() => {
            if (overlayWindow && !overlayWindow.isDestroyed()) {
              overlayWindow.setIgnoreMouseEvents(true, { forward: true });
              // Re-assert top level in case other windows try to overlap
              overlayWindow.setAlwaysOnTop(true, "screen-saver");
            }
          }, 1000);

          // Sync highlight setting to overlay with a small delay to ensure it's ready
          setTimeout(() => {
            if (overlayWindow && !overlayWindow.isDestroyed()) {
              overlayWindow.webContents.send("overlay-settings", {
                showClickHighlights: settings.showClickHighlights,
                highlightLeftColor: settings.highlightLeftColor || "#FFEB3B",
                highlightRightColor: settings.highlightRightColor || "#2196F3",
                highlightRippleSize: settings.highlightRippleSize || 50,
                highlightRippleSpeed: settings.highlightRippleSpeed || 400,
                highlightGlowSize: settings.highlightGlowSize || 25,
                highlightGlowIntensity: settings.highlightGlowIntensity || 30
              });
            }
          }, 200);
        } else if (!recording) {
          // Stop global click hook
          setupClickHighlightHook(false);

          // If stopped recording, hide the overlay
          if (overlayWindow && !overlayWindow.isDestroyed()) {
            overlayWindow.hide();
            // Also sync state to off
            overlayWindow.webContents.send("overlay-settings", {
              showClickHighlights: false
            });
          }

          if (overlayMoveTopInterval) {
            clearInterval(overlayMoveTopInterval);
            overlayMoveTopInterval = null;
          }
          if (forwardingPulseInterval) {
            clearInterval(forwardingPulseInterval);
            forwardingPulseInterval = null;
          }
        }
      }

      return { success: true };
    } catch (err) {
      log("error", `set-recording-state failed: ${err.message}`);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle("camera-window-toggle", (_, show) => {
    if (!cameraWindow || cameraWindow.isDestroyed()) return;
    if (show) {
      cameraWindow.showInactive();
      cameraWindow.setAlwaysOnTop(true, "screen-saver");
      cameraWindow.webContents.send("camera-status", true); // Send start signal
    } else {
      cameraWindow.webContents.send("camera-status", false); // Send stop signal
      cameraWindow.hide();
    }
  });

  ipcMain.handle("update-camera-settings", (_, settings) => {
    if (!cameraWindow || cameraWindow.isDestroyed()) return;

    let newSize = 200; // medium
    if (settings.webcamSize === "small") newSize = 150;
    else if (settings.webcamSize === "large") newSize = 300;

    // Maintain square constraint and resize based on settings
    cameraWindow.setSize(newSize, newSize);

    // Forward the desired deviceId to the floating window
    cameraWindow.webContents.send("update-camera", settings.selectedCamera);
  });

  ipcMain.handle("get-camera-window-bounds", () => {

    if (!cameraWindow || cameraWindow.isDestroyed()) return null;
    return cameraWindow.getBounds();
  });
}

module.exports = {
  setMainWindowRef,
  setOverlayWindowRef,
  setMiniControlsWindowRef,
  setCameraWindowRef,
  setupIpcHandlers,
};
