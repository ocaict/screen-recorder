const ffmpeg = require("fluent-ffmpeg");
const path = require("path");
const fs = require("fs");
const { app } = require("electron");
const { log } = require("./logger");

let ffmpegPath = null;

function checkHardwareEncoders() {
  return new Promise((resolve) => {
    const encoders = {
      nvenc: { h264: false, hevc: false },
      qsv: { h264: false, hevc: false },
      amf: { h264: false, hevc: false },
    };

    const systemFfmpeg = getSystemFfmpegPath();
    if (systemFfmpeg) {
      const { execSync } = require("child_process");
      try {
        const output = execSync(
          `"${systemFfmpeg}" -hide_banner -encoders 2>&1`,
          { encoding: "utf8", timeout: 10000 },
        );

        // Basic presence check
        const hasNvenc = output.includes("h264_nvenc");
        const hasQsv = output.includes("h264_qsv");
        const hasAmf = output.includes("h264_amf");

        // --- DEEP CHECK: Try to actually open the encoder (Detects driver issues) ---
        if (hasNvenc) {
          try {
            execSync(`"${systemFfmpeg}" -hide_banner -f lavfi -i color=c=black:s=64x64:d=0.1 -c:v h264_nvenc -f null - 2>&1`, { timeout: 3000 });
            encoders.nvenc.h264 = true;
          } catch (e) { log("warn", "NVENC listed but failed initialization test (Driver issue?). Disabling."); }
        }

        if (hasQsv) {
          try {
            execSync(`"${systemFfmpeg}" -hide_banner -f lavfi -i color=c=black:s=64x64:d=0.1 -c:v h264_qsv -f null - 2>&1`, { timeout: 3000 });
            encoders.qsv.h264 = true;
          } catch (e) { log("warn", "QSV listed but failed initialization test. Disabling."); }
        }

        if (hasAmf) {
          try {
            execSync(`"${systemFfmpeg}" -hide_banner -f lavfi -i color=c=black:s=64x64:d=0.1 -c:v h264_amf -f null - 2>&1`, { timeout: 3000 });
            encoders.amf.h264 = true;
          } catch (e) { log("warn", "AMF listed but failed initialization test. Disabling."); }
        }

        const nvencAvailable = encoders.nvenc.h264;
        const qsvAvailable = encoders.qsv.h264;
        const amfAvailable = encoders.amf.h264;

        log(
          "info",
          `Hardware encoders - NVENC: ${nvencAvailable ? "available" : "unavailable"}, QSV: ${qsvAvailable ? "available" : "unavailable"}, AMF: ${amfAvailable ? "available" : "unavailable"}`,
        );
      } catch (err) {
        log(
          "warn",
          `Failed to check hardware encoders with system FFmpeg: ${err.message}`,
        );
      }
    } else {
      log(
        "info",
        `No system FFmpeg found. Hardware acceleration requires system FFmpeg to be installed.`,
      );
    }

    resolve(encoders);
  });
}

function getSystemFfmpegPath() {
  const { execSync } = require("child_process");
  const { env } = require("process");

  const possiblePaths = [
    "C:\\ffmpeg\\bin\\ffmpeg.exe",
    "C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe",
    "C:\\Program Files (x86)\\ffmpeg\\bin\\ffmpeg.exe",
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      log("info", `Found system FFmpeg at: ${p}`);
      return p;
    }
  }

  try {
    const pathResult = execSync('cmd /c "where ffmpeg" 2>nul', {
      encoding: "utf8",
      timeout: 5000,
    });
    const ffmpegPath = pathResult.trim().split("\n")[0].trim();
    if (ffmpegPath && fs.existsSync(ffmpegPath)) {
      log("info", `Found system FFmpeg in PATH: ${ffmpegPath}`);
      return ffmpegPath;
    }
  } catch (err) {
    log("warn", `Could not find FFmpeg in PATH: ${err.message}`);
  }

  try {
    const result = execSync("ffmpeg -version", {
      encoding: "utf8",
      timeout: 5000,
    });
    if (result.includes("ffmpeg version")) {
      log("info", "FFmpeg available in PATH (direct call worked)");
      return "ffmpeg";
    }
  } catch (err) {
    log("warn", `Direct ffmpeg call failed: ${err.message}`);
  }

  return null;
}

let availableEncoders = null;

async function getAvailableEncoders() {
  if (!availableEncoders) {
    availableEncoders = await checkHardwareEncoders();
  }
  return availableEncoders;
}

function resetEncoderCheck() {
  availableEncoders = null;
}

function setupFfmpeg() {
  try {
    const systemFfmpeg = getSystemFfmpegPath();

    if (systemFfmpeg && fs.existsSync(systemFfmpeg)) {
      ffmpegPath = systemFfmpeg;
      ffmpeg.setFfmpegPath(ffmpegPath);
      log("info", `Using system FFmpeg: ${ffmpegPath}`);
    } else {
      if (app.isPackaged) {
        ffmpegPath = path.join(process.resourcesPath, "ffmpeg.exe");
      } else {
        try {
          ffmpegPath = require("ffmpeg-static");
        } catch (e) {
          ffmpegPath = null;
        }
      }

      if (ffmpegPath && fs.existsSync(ffmpegPath)) {
        ffmpeg.setFfmpegPath(ffmpegPath);
        log("info", `FFmpeg path set: ${ffmpegPath}`);
      } else {
        log(
          "warn",
          "FFmpeg not found at expected path, relying on system PATH ffmpeg if available",
        );
      }
    }

    getAvailableEncoders().then((encoders) => {
      log(
        "info",
        `Hardware encoders detected: NVENC=${encoders.nvenc}, QSV=${encoders.qsv}, AMF=${encoders.amf}`,
      );
    });
  } catch (err) {
    log("error", `Failed to setup ffmpeg: ${err.message}`);
  }
}

async function convertVideo(inputPath, outputPath, onProgress) {
  return new Promise(async (resolve, reject) => {
    const settings = require("./settings").getSettings();

    let crf = 23;
    let preset = "medium";
    let audioBitrate = "128k";

    switch (settings.compression) {
      case "maximum":
        crf = 32;
        preset = "ultrafast";
        audioBitrate = "64k";
        break;
      case "balanced":
        crf = 23;
        preset = "medium";
        audioBitrate = "128k";
        break;
      case "quality":
        crf = 15;
        preset = "slow";
        audioBitrate = "192k";
        break;
    }

    const hwAccel = settings.hardwareAcceleration || "none";
    const preferredCodec = settings.videoCodec || "libx264";
    const qualityMode = settings.qualityControl || "crf";
    const selectedCrf = settings.crfValue !== undefined ? settings.crfValue : crf;
    const selectedBitrate = (settings.videoBitrate || 5) + "M";
    const colorFmt = settings.colorFormat || "yuv420p";

    let useHwEncoder = false;
    let selectedEncoder = null;
    let cmd = ffmpeg(inputPath);

    if (hwAccel !== "none") {
      const encoders = await getAvailableEncoders();
      const systemFfmpeg = getSystemFfmpegPath();
      const isHevcRequested = preferredCodec === "libx265";

      if (encoders && encoders[hwAccel] && systemFfmpeg && fs.existsSync(systemFfmpeg)) {
        const hwEncoders = encoders[hwAccel];

        if (isHevcRequested && hwEncoders.hevc) {
          selectedEncoder = `hevc_${hwAccel}`;
        } else if (hwEncoders.h264) {
          selectedEncoder = `h264_${hwAccel}`;
        }

        if (selectedEncoder) {
          useHwEncoder = true;
          try {
            ffmpeg.setFfmpegPath(systemFfmpeg);
            ffmpegPath = systemFfmpeg;
          } catch (err) {
            log("warn", `Failed to set system FFmpeg path: ${err.message}`);
          }
        }
      }
    }

    if (useHwEncoder && selectedEncoder) {
      cmd = cmd.outputOptions("-c:v", selectedEncoder);
      if (hwAccel === "nvenc") {
        cmd.outputOptions("-preset", "p4", "-rc", "vbr", "-cq", selectedCrf.toString());
        if (!selectedEncoder.includes("hevc")) cmd.outputOptions("-tune", "hq");
      } else if (hwAccel === "qsv") {
        cmd.outputOptions("-preset", "balanced", "-global_quality", selectedCrf.toString());
      } else if (hwAccel === "amf") {
        cmd.outputOptions("-quality", "balanced", "-rc", "vbr_latency");
      }

      if (qualityMode === "vbr") {
        cmd.outputOptions("-b:v", selectedBitrate, "-maxrate", selectedBitrate);
      }
    } else {
      const swCodec = preferredCodec.startsWith("lib") ? preferredCodec : "libx264";
      cmd = cmd.outputOptions("-c:v", swCodec).outputOptions("-preset", preset);

      if (qualityMode === "crf") {
        cmd.outputOptions("-crf", selectedCrf.toString());
      } else {
        cmd.outputOptions("-b:v", selectedBitrate, "-maxrate", selectedBitrate, "-bufsize", (parseInt(selectedBitrate) * 2) + "M");
      }

      if (swCodec === "libx265") cmd.outputOptions("-vtag", "hvc1");
    }

    cmd = cmd
      .outputOptions("-movflags", "+faststart")
      .outputOptions("-pix_fmt", colorFmt)
      .outputOptions("-r", (settings.frameRate || 24).toString())
      .outputOptions("-c:a", "aac")
      .outputOptions("-b:a", audioBitrate)
      .outputOptions("-shortest")
      .outputOptions("-avoid_negative_ts", "make_zero")
      .format("mp4");

    cmd
      .on("start", (cmdLine) => {
        log("info", `FFmpeg started: ${cmdLine}`);
        // Lower FFmpeg process priority entirely to background so system doesn't freeze
        try {
          const { exec } = require("child_process");
          if (process.platform === "win32") {
            exec(`powershell -command "Get-Process ffmpeg -ErrorAction SilentlyContinue | ForEach-Object { $_.PriorityClass = 'BelowNormal' }"`, () => { });
          } else {
            exec(`renice -n 10 $(pgrep ffmpeg)`, () => { });
          }
        } catch (e) {
          log("warn", "Could not lower FFmpeg priority: " + e.message);
        }
      })
      .on("progress", (progress) => {
        if (onProgress) {
          let percent = progress.percent || 0;
          const timemark = progress.timemark || "00:00:00";

          if (percent === 0 && progress.timemark && settings.frameRate) {
            const parts = progress.timemark.split(":");
            if (parts.length === 3) {
              const seconds =
                parseInt(parts[0]) * 3600 +
                parseInt(parts[1]) * 60 +
                parseFloat(parts[2]);
              const duration = settings.frameRate * 10;
              percent = Math.min((seconds / duration) * 100, 99);
            }
          }

          onProgress({
            percent: percent,
            timemark: timemark,
            targetSize: progress.targetSize || 0,
          });
        }
      })
      .on("end", () => {
        log("info", `Conversion complete: ${outputPath}`);
        resolve(outputPath);
      })
      .on("error", async (err) => {
        log(
          "error",
          `Conversion error: ${err.message}, input: ${inputPath}, output: ${outputPath}`,
        );

        // If a hardware encoder failed due to driver/API issues, attempt software fallback
        const msg = err && err.message ? err.message.toLowerCase() : "";
        const hwError =
          useHwEncoder &&
          (msg.includes("nvenc") ||
            msg.includes("qsv") ||
            msg.includes("amf") ||
            msg.includes("driver") ||
            msg.includes("codec") ||
            msg.includes("encoder") ||
            msg.includes("not found") ||
            msg.includes("unknown"));

        if (useHwEncoder && hwError) {
          log(
            "warn",
            "Hardware encoding failed, attempting software fallback (libx264)",
          );
          if (onProgress) {
            try {
              onProgress({
                warning:
                  "Hardware encoder failed, falling back to software encoding",
              });
            } catch (e) {
              // ignore
            }
          }

          try {
            // Run software encode
            const swCmd = ffmpeg(inputPath)
              .outputOptions("-c:v", "libx264")
              .outputOptions("-crf", selectedCrf.toString())
              .outputOptions("-preset", "ultrafast")
              .outputOptions("-movflags", "+faststart")
              .outputOptions("-pix_fmt", colorFmt)
              .outputOptions("-r", (settings.frameRate || 24).toString())
              .outputOptions("-c:a", "aac")
              .outputOptions("-b:a", audioBitrate)
              .format("mp4");

            swCmd.on("start", (cmdLine) => {
              log("info", `FFmpeg (software) started: ${cmdLine}`);
              try {
                const { exec } = require("child_process");
                if (process.platform === "win32") {
                  exec(`powershell -command "Get-Process ffmpeg -ErrorAction SilentlyContinue | ForEach-Object { $_.PriorityClass = 'BelowNormal' }"`, () => { });
                } else {
                  exec(`renice -n 10 $(pgrep ffmpeg)`, () => { });
                }
              } catch (e) {
                log("warn", "Could not lower FFmpeg priority: " + e.message);
              }
            });

            swCmd.on("progress", (progress) => {
              if (onProgress) {
                onProgress({
                  percent: progress.percent || 0,
                  timemark: progress.timemark || "00:00:00",
                  targetSize: progress.targetSize || 0,
                });
              }
            });

            await new Promise((res, rej) => {
              swCmd
                .on("end", () => res())
                .on("error", (e) => rej(e))
                .save(outputPath);
            });

            log("info", `Software conversion complete: ${outputPath}`);
            return resolve(outputPath);
          } catch (swErr) {
            log("error", `Software fallback failed: ${swErr.message}`);
            return reject(err);
          }
        }

        reject(err);
      })
      .save(outputPath);
  });
}

function getVideoDuration(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) {
        reject(err);
      } else {
        resolve(metadata.format.duration);
      }
    });
  });
}

async function trimVideo(inputPath, startTime, endTime) {
  return new Promise((resolve, reject) => {
    const ext = path.extname(inputPath);
    const dir = path.dirname(inputPath);
    const name = path.basename(inputPath, ext);
    const outputPath = path.join(dir, `${name}_trimmed_${Date.now()}${ext}`);

    ffmpeg(inputPath)
      .setStartTime(startTime)
      .outputOptions("-to", endTime.toString())
      .outputOptions("-c", "copy")
      .on("start", (cmdLine) => {
        log("info", `Trimming started: ${cmdLine}`);
      })
      .on("end", () => {
        log("info", `Trimming complete: ${outputPath}`);
        resolve({ success: true, outputPath });
      })
      .on("error", (err) => {
        log("error", `Trimming error: ${err.message}`);
        reject(err);
      })
      .save(outputPath);
  });
}

async function generateThumbnail(inputPath, outputPath, timestamp = "00:00:01") {
  return new Promise((resolve, reject) => {
    // Using inputOptions before input for fast seek
    ffmpeg(inputPath)
      .inputOptions("-ss", timestamp)
      .outputOptions("-frames:v", "1")
      .outputOptions("-q:v", "2") // High quality
      .size("320x?")
      .save(outputPath)
      .on("end", () => {
        log("info", `Thumbnail generated: ${outputPath}`);
        resolve(outputPath);
      })
      .on("error", (err) => {
        log("error", `Thumbnail generation error: ${err.message}`);
        reject(err);
      });
  });
}

async function exportToGif(
  inputPath,
  startTime,
  endTime,
  onProgress,
  fps = 15,
  scale = 720,
) {
  return new Promise((resolve, reject) => {
    const ext = path.extname(inputPath);
    const dir = path.dirname(inputPath);
    const name = path.basename(inputPath, ext);
    const outputPath = path.join(dir, `${name}_${Date.now()}.gif`);

    ffmpeg(inputPath)
      .setStartTime(startTime)
      .outputOptions("-to", endTime.toString())
      .complexFilter([
        `fps=${fps},scale=${scale}:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse`,
      ])
      .on("start", (cmdLine) => {
        log("info", `GIF export started: ${cmdLine}`);
      })
      .on("progress", (progress) => {
        if (onProgress) {
          let percent = progress.percent;
          const duration = endTime - startTime;

          if (duration > 0 && progress.timemark) {
            const parts = progress.timemark.split(":");
            if (parts.length === 3) {
              const seconds =
                parseInt(parts[0]) * 3600 +
                parseInt(parts[1]) * 60 +
                parseFloat(parts[2]);
              percent = Math.min((seconds / duration) * 100, 99.9);
            }
          }
          onProgress(percent || 0);
        }
      })
      .on("end", () => {
        log("info", `GIF export complete: ${outputPath}`);
        resolve({ success: true, outputPath });
      })
      .on("error", (err) => {
        log("error", `GIF export error: ${err.message}`);
        reject(err);
      })
      .save(outputPath);
  });
}

async function mergeVideos(inputPaths, outputPath, onProgress) {
  // Pre-calculate total duration for accurate progress
  let totalDuration = 0;
  try {
    const durations = await Promise.all(
      inputPaths.map((p) => getVideoDuration(p)),
    );
    totalDuration = durations.reduce((a, b) => a + b, 0);
  } catch (err) {
    log("warn", `Could not pre-calculate duration for merge: ${err.message}`);
  }

  return new Promise((resolve, reject) => {
    if (!inputPaths || inputPaths.length < 2) {
      return reject(new Error("Need at least 2 videos to merge"));
    }

    const command = ffmpeg();

    // Add all inputs
    inputPaths.forEach((p) => command.input(p));

    command
      .on("start", (cmdLine) => {
        log("info", `Merging started: ${cmdLine}`);
      })
      .on("progress", (progress) => {
        if (onProgress) {
          let percent = progress.percent;

          // If percent is weird or we have total duration, calculate manually
          if (totalDuration > 0 && progress.timemark) {
            const parts = progress.timemark.split(":");
            if (parts.length === 3) {
              const seconds =
                parseInt(parts[0]) * 3600 +
                parseInt(parts[1]) * 60 +
                parseFloat(parts[2]);
              percent = Math.min((seconds / totalDuration) * 100, 99.9);
            }
          }

          onProgress(percent || 0);
        }
      })
      .on("end", () => {
        log("info", `Merging complete: ${outputPath}`);
        resolve({ success: true, outputPath });
      })
      .on("error", (err) => {
        log("error", `Merging error: ${err.message}`);
        reject(err);
      })
      // Use the merge technique that re-encodes (more reliable for different sources)
      .mergeToFile(outputPath, path.dirname(outputPath));
  });
}

setupFfmpeg();

module.exports = {
  convertVideo,
  trimVideo,
  getVideoDuration,
  generateThumbnail,
  setupFfmpeg,
  getAvailableEncoders,
  resetEncoderCheck,
  getSystemFfmpegPath,
  exportToGif,
  mergeVideos,
};
