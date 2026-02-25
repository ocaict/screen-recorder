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

        // Check NVIDIA NVENC
        encoders.nvenc.h264 = output.includes("h264_nvenc");
        encoders.nvenc.hevc = output.includes("hevc_nvenc");

        // Check Intel QSV
        encoders.qsv.h264 = output.includes("h264_qsv");
        encoders.qsv.hevc = output.includes("hevc_qsv");

        // Check AMD AMF
        encoders.amf.h264 = output.includes("h264_amf");
        encoders.amf.hevc = output.includes("hevc_amf");

        const nvencAvailable = encoders.nvenc.h264 || encoders.nvenc.hevc;
        const qsvAvailable = encoders.qsv.h264 || encoders.qsv.hevc;
        const amfAvailable = encoders.amf.h264 || encoders.amf.hevc;

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
    let useHwEncoder = false;
    let selectedEncoder = null;
    let cmd = ffmpeg(inputPath);

    if (hwAccel !== "none") {
      const encoders = await getAvailableEncoders();
      const systemFfmpeg = getSystemFfmpegPath();

      log(
        "info",
        `HW check: requested=${hwAccel}, available=${JSON.stringify(encoders)}`,
      );

      if (
        encoders &&
        encoders[hwAccel] &&
        systemFfmpeg &&
        fs.existsSync(systemFfmpeg)
      ) {
        const hwEncoders = encoders[hwAccel];

        // Prefer HEVC for better compression if available, otherwise use H.264
        if (hwEncoders.hevc) {
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

          log(
            "info",
            `Using hardware encoder: ${selectedEncoder} (${hwAccel.toUpperCase()})`,
          );
        }
      } else {
        log(
          "warn",
          `Hardware encoder ${hwAccel} not available or system FFmpeg not found. Using software encoding.`,
        );
      }
    }

    if (useHwEncoder && selectedEncoder) {
      if (hwAccel === "nvenc") {
        const isHevc = selectedEncoder.includes("hevc");
        cmd = cmd
          .outputOptions("-c:v", selectedEncoder)
          .outputOptions("-preset", "default")
          .outputOptions("-rc", "vbr")
          .outputOptions("-cq", "19");
        if (!isHevc) {
          cmd.outputOptions("-tune", "hq");
        }
      } else if (hwAccel === "qsv") {
        const bitrate = settings.compression === "maximum" ? "2000k" : "4000k";
        cmd = cmd
          .outputOptions("-c:v", selectedEncoder)
          .outputOptions("-preset", "balanced")
          .outputOptions("-b:v", bitrate);
      } else if (hwAccel === "amf") {
        cmd = cmd
          .outputOptions("-c:v", selectedEncoder)
          .outputOptions("-quality", "quality")
          .outputOptions("-rc", "vbr");
      }
    } else {
      cmd = cmd
        .outputOptions("-c:v", "libx264")
        .outputOptions("-crf", crf.toString())
        .outputOptions("-preset", preset);
    }

    cmd = cmd
      .outputOptions("-movflags", "+faststart")
      .outputOptions("-pix_fmt", "yuv420p")
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
              .outputOptions("-crf", crf.toString())
              .outputOptions("-preset", preset)
              .outputOptions("-movflags", "+faststart")
              .outputOptions("-pix_fmt", "yuv420p")
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

setupFfmpeg();

module.exports = {
  convertVideo,
  getVideoDuration,
  setupFfmpeg,
  getAvailableEncoders,
  resetEncoderCheck,
  getSystemFfmpegPath,
};
