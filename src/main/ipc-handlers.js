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

let mainWindow = null;
let overlayWindow = null;
let ICON_PATH = null;

// Active chunked recording sessions: sessionId -> { ws, tempFilePath, size }
const chunkSessions = new Map();

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

async function saveRecording(streamData, chunkFiles = [], forceAutoSave = false) {
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

  if (autoSave || forceAutoSave) {
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
        .then(async () => {
          if (fs.existsSync(tempFilePath)) {
            fs.unlinkSync(tempFilePath);
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
          fs.renameSync(tempFilePath, webmPath);
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
      fs.renameSync(tempFilePath, filePath);
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

        // Quality settings
        let crf = 23;
        if (settings.videoQuality === "medium") crf = 26;
        if (settings.videoQuality === "low") crf = 30;

        const hwAccel = settings.hardwareAcceleration || "none";
        let v_codec = "libx264";
        let v_options = [];

        // Dynamic Hardware Encoder Selection
        try {
          const encoders = await ffmpegModule.getAvailableEncoders();
          if (hwAccel !== "none") {
            if ((hwAccel === "nvenc" || hwAccel === "auto") && encoders.nvenc && encoders.nvenc.h264) {
              v_codec = "h264_nvenc";
              v_options = ["-preset", "p4", "-rc", "vbr", "-cq", crf.toString()];
            } else if ((hwAccel === "qsv" || hwAccel === "auto") && encoders.qsv && encoders.qsv.h264) {
              v_codec = "h264_qsv";
              v_options = ["-preset", "balanced", "-global_quality", crf.toString()];
            } else if ((hwAccel === "amf" || hwAccel === "auto") && encoders.amf && encoders.amf.h264) {
              v_codec = "h264_amf";
              v_options = ["-quality", "balanced", "-rc", "vbr_latency"];
            }
          }
        } catch (encErr) {
          log("warn", `Could not query encoders: ${encErr.message}`);
        }

        if (v_codec === "libx264") {
          v_options = ["-preset", "ultrafast", "-tune", "zerolatency", "-crf", crf.toString(), "-maxrate", "5M", "-bufsize", "10M"];
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
          "-thread_queue_size", "4096",
          "-probesize", "2M",
          "-analyzeduration", "2000000",
          "-fflags", "+genpts+igndts",
          "-threads", "0",
          "-f", "webm",
          "-i", "pipe:0",
          "-c:v", v_codec,
          ...v_options,
          "-r", String(settings.frameRate || 24),
          "-c:a", "aac",
          "-b:a", "128k",
          "-pix_fmt", "yuv420p",
          "-movflags", "+frag_keyframe+empty_moov+default_base_moof",
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
              v_codec !== "libx264" &&
              (msg.includes("Driver does not support") ||
                msg.includes("Error while opening encoder") ||
                msg.includes("EBML header parsing failed"))
            ) {
              hasFailedPrematurely = true;
              log("info", "HW encoder failed, retrying with libx264...");
              try { proc.kill(); } catch (e) { }

              const swArgs = [...args];
              const vIdx = swArgs.indexOf("-c:v");
              if (vIdx !== -1) {
                swArgs[vIdx + 1] = "libx264";
                swArgs.splice(vIdx + 2, v_options.length, "-preset", "ultrafast", "-tune", "zerolatency", "-crf", crf.toString());
              }
              ffmpegProcess = spawn(ffmpegPath, swArgs);
              setupHandlers(ffmpegProcess, true);

              const sess = chunkSessions.get(sessionId);
              if (sess) {
                sess.ffmpegProcess = ffmpegProcess;
                if (sess.initialBuffer) {
                  for (const chunk of sess.initialBuffer) {
                    if (ffmpegProcess.stdin.writable) ffmpegProcess.stdin.write(chunk);
                  }
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
              if (sess.initialBuffer) {
                sess.initialBuffer.forEach(c => sess.ws.write(c));
                sess.initialBuffer = null;
              }
              if (sess.writeQueue) {
                sess.writeQueue.forEach(c => sess.ws.write(c));
                sess.writeQueue = [];
              }
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
          isFinalizing: false,
          initialBuffer: [],
          isStable: false,
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
      chunkSessions.set(sessionId, { ws, tempFilePath, size: 0, isLive: false });
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

      const buf = Buffer.from(uint8Array);

      if (sess.isLive && sess.ffmpegProcess) {
        if (sess.isFinalizing) return;

        // Keep initial chunks for HW-encoder recovery
        if (sess.initialBuffer && sess.initialBuffer.length < 40) {
          sess.initialBuffer.push(buf);
          if (sess.initialBuffer.length === 40) {
            sess.isStable = true;
            setTimeout(() => { if (sess.initialBuffer) sess.initialBuffer = null; }, 2000);
          }
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
            // Drain remaining queue
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

            // Wait for FFmpeg to fully exit
            await new Promise(resolve => {
              if (!sess.ffmpegProcess || sess.ffmpegProcess.exitCode !== null) return resolve();
              sess.ffmpegProcess.on("close", resolve);
              setTimeout(resolve, 10000);
            });

            const finalPath = sess.finalPath;
            chunkSessions.delete(sessionId);

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
}

module.exports = {
  setMainWindowRef,
  setOverlayWindowRef,
  setupIpcHandlers,
};
