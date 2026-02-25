class RecordingManager {
  constructor(app, monitor) {
    this.app = app;
    this.monitor = monitor;
    this.videoStream = null;
    this.audioStream = null;
    this.webcamStream = null;
    this.mixedStream = null;
    this.mediaRecorder = null;
    this.recordedChunks = [];
    this.isRecording = false;
    this.isPaused = false;
    this.selectedSource = null;
    this.selectedRegion = null;
    this.selectedAudioDevice = null;
    this.recordingStartTime = null;
    this.recordingTimer = null;
    this.recordedBytes = 0;

    this.chunkFiles = [];
    this.chunkInterval = null;
    this.tempDir = null;

    this.compositor = null;
    this.canvasStream = null;
    this.compositorInterval = null;
  }

  async init() {
    try {
      const paths = await window.electronAPI.getAppPaths();
      if (!paths || !paths.temp) {
        throw new Error("Failed to get app paths");
      }
      this.tempDir = paths.temp;
    } catch (err) {
      console.error("RecordingManager init failed:", err);
      this.app.showToast(
        `Failed to initialize recording: ${err.message}`,
        "error",
      );
    }
  }

  destroy() {
    // Stop any active recording
    if (this.isRecording) {
      this.stopRecording();
    }

    // Clean up streams
    this.stopCurrentStream();

    // Stop recording timer if active
    if (this.recordingTimer) {
      clearInterval(this.recordingTimer);
      this.recordingTimer = null;
    }

    // Stop chunked recording interval
    if (this.chunkInterval) {
      clearInterval(this.chunkInterval);
      this.chunkInterval = null;
    }

    // Cancel compositor RAF
    if (this.compositorDrawId) {
      cancelAnimationFrame(this.compositorDrawId);
      this.compositorDrawId = null;
    }

    // Stop media recorder
    if (this.mediaRecorder) {
      try {
        if (this.mediaRecorder.state !== "inactive") {
          this.mediaRecorder.stop();
        }
      } catch (e) {
        console.warn("Error stopping media recorder:", e);
      }
      this.mediaRecorder = null;
    }

    // Clear recorded chunks
    this.recordedChunks = [];
    this.recordedBytes = 0;
    this.chunkFiles = [];
  }

  async setupVideoStream(source) {
    try {
      this.stopCurrentStream();

      const resolution = this.app.settings.resolution || "1920x1080";
      const [width, height] = resolution.split("x").map(Number);
      const frameRate = this.app.settings.frameRate || 30;

      try {
        this.videoStream = await navigator.mediaDevices.getUserMedia({
          video: {
            mandatory: {
              chromeMediaSource: "desktop",
              chromeMediaSourceId: source.id,
              minWidth: width,
              maxWidth: width,
              minHeight: height,
              maxHeight: height,
              minFrameRate: frameRate,
              maxFrameRate: frameRate,
            },
          },
          audio: false,
        });
      } catch (streamErr) {
        this.app.showToast(
          `Failed to access source: ${streamErr.message}`,
          "error",
        );
        console.error("Stream error:", streamErr);
        throw streamErr;
      }

      try {
        this.app.previewVideo.srcObject = this.videoStream;
        await this.app.previewVideo.play();
      } catch (playErr) {
        console.warn("Preview play failed:", playErr);
        this.app.showToast("Source connected but preview failed", "warn");
      }

      this.app.noSourceMessage.classList.add("hidden");
      this.app.showToast("Source connected", "success");
    } catch (err) {
      this.stopCurrentStream();
      this.app.showToast(`Failed to connect: ${err.message}`, "error");
      console.error(err);
    }
  }

  async setupRegionStream(includeAnnotations = false) {
    try {
      this.stopCurrentStream();

      const region = this.selectedRegion;
      const frameRate = this.app.settings.frameRate || 30;

      let sources;
      try {
        sources = await window.electronAPI.getCaptureSources();
      } catch (sourcesErr) {
        console.error("Failed to get capture sources:", sourcesErr);
        this.app.showToast(
          `Failed to get sources: ${sourcesErr.message}`,
          "error",
        );
        this.videoStream = null;
        return;
      }

      const screenSource = sources?.find((s) => s.id.startsWith("screen:"));

      if (!screenSource) {
        this.app.showToast("No screen available for region capture", "error");
        this.videoStream = null;
        return;
      }

      try {
        this.fullScreenStream = await navigator.mediaDevices.getUserMedia({
          video: {
            mandatory: {
              chromeMediaSource: "desktop",
              chromeMediaSourceId: screenSource.id,
              minWidth: 1920,
              maxWidth: 3840,
              minHeight: 1080,
              maxHeight: 2160,
              minFrameRate: frameRate,
              maxFrameRate: frameRate,
            },
          },
          audio: false,
        });
      } catch (streamErr) {
        console.error("Region stream error:", streamErr);
        this.app.showToast(`Failed to capture: ${streamErr.message}`, "error");
        this.videoStream = null;
        return;
      }

      this.fullScreenVideo = document.createElement("video");
      this.fullScreenVideo.srcObject = this.fullScreenStream;
      this.fullScreenVideo.muted = true;
      this.fullScreenVideo.playsInline = true;
      await this.fullScreenVideo.play();

      if (includeAnnotations && this.app.annotationManager) {
        this.regionCompositor = document.createElement("canvas");
        this.regionCompositor.width = region.width;
        this.regionCompositor.height = region.height;
        this.regionCompositorCtx = this.regionCompositor.getContext("2d");

        const drawRegionFrame = () => {
          if (!this.fullScreenVideo || this.fullScreenVideo.readyState < 2)
            return;

          this.regionCompositorCtx.drawImage(
            this.fullScreenVideo,
            region.x,
            region.y,
            region.width,
            region.height,
            0,
            0,
            region.width,
            region.height,
          );

          const annotationCanvas = this.app.annotationManager.getCanvas();
          const tempCanvas = this.app.annotationManager.getTempCanvas();

          this.regionCompositorCtx.drawImage(
            annotationCanvas,
            region.x,
            region.y,
            region.width,
            region.height,
            0,
            0,
            region.width,
            region.height,
          );
          this.regionCompositorCtx.drawImage(
            tempCanvas,
            region.x,
            region.y,
            region.width,
            region.height,
            0,
            0,
            region.width,
            region.height,
          );
        };

        drawRegionFrame();
        this.cropInterval = setInterval(drawRegionFrame, 1000 / frameRate);

        this.canvasStream = this.regionCompositor.captureStream(frameRate);
        this.videoStream = this.canvasStream;
      } else {
        this.cropCanvas = document.createElement("canvas");
        this.cropCanvas.width = region.width;
        this.cropCanvas.height = region.height;
        this.cropCtx = this.cropCanvas.getContext("2d");

        const cropFrame = () => {
          if (!this.fullScreenVideo || this.fullScreenVideo.readyState < 2)
            return;

          this.cropCtx.drawImage(
            this.fullScreenVideo,
            region.x,
            region.y,
            region.width,
            region.height,
            0,
            0,
            region.width,
            region.height,
          );
        };

        cropFrame();
        this.cropInterval = setInterval(cropFrame, 1000 / frameRate);

        this.canvasStream = this.cropCanvas.captureStream(frameRate);
        this.videoStream = this.canvasStream;
      }

      try {
        this.app.previewVideo.srcObject = this.videoStream;
        await this.app.previewVideo.play();
      } catch (playErr) {
        console.warn("Preview play failed:", playErr);
      }

      this.app.noSourceMessage.classList.add("hidden");
      this.app.showToast("Region capture ready", "success");
    } catch (err) {
      this.stopCurrentStream();
      this.app.showToast(`Failed to setup region: ${err.message}`, "error");
      console.error(err);
    }
  }

  async setupAudioStream() {
    try {
      const micDeviceId =
        this.app.settings.selectedMicrophone !== "default"
          ? this.app.settings.selectedMicrophone
          : undefined;
      this.audioStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          deviceId: micDeviceId ? { exact: micDeviceId } : undefined,
        },
      });
    } catch (audioErr) {
      console.warn("Could not get audio stream:", audioErr);
      this.app.showToast(
        "Audio device unavailable, recording video only",
        "info",
      );
    }
  }

  stopCurrentStream() {
    try {
      if (this.videoStream) {
        this.videoStream.getTracks().forEach((track) => {
          try {
            track.stop();
          } catch (e) {
            console.warn("Failed to stop video track:", e);
          }
        });
        this.videoStream = null;
      }
    } catch (e) {
      console.warn("Error stopping video stream:", e);
      this.videoStream = null;
    }

    try {
      if (this.audioStream) {
        this.audioStream.getTracks().forEach((track) => {
          try {
            track.stop();
          } catch (e) {
            console.warn("Failed to stop audio track:", e);
          }
        });
        this.audioStream = null;
      }
    } catch (e) {
      console.warn("Error stopping audio stream:", e);
      this.audioStream = null;
    }

    try {
      if (this.webcamStream) {
        this.webcamStream.getTracks().forEach((track) => {
          try {
            track.stop();
          } catch (e) {
            console.warn("Failed to stop webcam track:", e);
          }
        });
        this.webcamStream = null;
      }
    } catch (e) {
      console.warn("Error stopping webcam stream:", e);
      this.webcamStream = null;
    }

    if (this.compositorInterval) {
      clearInterval(this.compositorInterval);
      this.compositorInterval = null;
    }
    if (this.compositorDrawId) {
      cancelAnimationFrame(this.compositorDrawId);
      this.compositorDrawId = null;
    }
    this.canvasStream = null;
    this.compositor = null;
    this.compositorOffscreenCanvas = null;

    if (this.cropInterval) {
      clearInterval(this.cropInterval);
      this.cropInterval = null;
    }
    if (this.fullScreenStream) {
      this.fullScreenStream.getTracks().forEach((track) => track.stop());
      this.fullScreenStream = null;
    }
    this.fullScreenVideo = null;
    this.cropCanvas = null;
    this.cropCtx = null;
    this.regionCompositor = null;
    this.regionCompositorCtx = null;

    try {
      this.app.previewVideo.srcObject = null;
    } catch (e) {
      console.warn("Error clearing preview:", e);
    }
  }

  async createCompositedStream(
    videoTracks,
    audioTracks,
    includeAnnotations = true,
  ) {
    const screenTrack = videoTracks[0].clone();

    const screenSettings = screenTrack.getSettings();
    const width = screenSettings.width || 1920;
    const height = screenSettings.height || 1080;
    const frameRate = screenSettings.frameRate || 30;

    // Use OffscreenCanvas for better performance (render thread vs main thread)
    const offscreenCanvas = new OffscreenCanvas(width, height);
    const ctx = offscreenCanvas.getContext("2d");

    if (!ctx) {
      throw new Error("Failed to get OffscreenCanvas context");
    }

    const screenStream = new MediaStream([screenTrack]);
    const screenVideo = document.createElement("video");
    screenVideo.srcObject = screenStream;
    screenVideo.muted = true;
    screenVideo.playsInline = true;
    await screenVideo.play();

    // Use requestAnimationFrame for frame-sync drawing instead of setInterval
    const drawFrame = () => {
      try {
        if (!this.isRecording) return;

        // Record frame timing for performance analysis
        if (this.monitor) {
          this.monitor.recordFrame();
        }

        ctx.drawImage(screenVideo, 0, 0, width, height);

        if (this.webcamStream) {
          const webcamWidth = 320;
          const webcamHeight = 240;
          let webcamX = 0;
          let webcamY = 0;

          const position = this.app.settings.webcamPosition || "bottom-right";
          const size = this.app.settings.webcamSize || "medium";

          let webcamDisplayWidth;
          switch (size) {
            case "small":
              webcamDisplayWidth = 120;
              break;
            case "large":
              webcamDisplayWidth = 240;
              break;
            default:
              webcamDisplayWidth = 180;
          }
          const webcamDisplayHeight =
            (webcamHeight / webcamWidth) * webcamDisplayWidth;

          switch (position) {
            case "top-left":
              webcamX = 20;
              webcamY = 20;
              break;
            case "top-right":
              webcamX = width - webcamDisplayWidth - 20;
              webcamY = 20;
              break;
            case "bottom-left":
              webcamX = 20;
              webcamY = height - webcamDisplayHeight - 20;
              break;
            case "bottom-right":
            default:
              webcamX = width - webcamDisplayWidth - 20;
              webcamY = height - webcamDisplayHeight - 20;
              break;
          }

          const webcamTrack = this.webcamStream.getVideoTracks()[0].clone();
          const webcamStream = new MediaStream([webcamTrack]);
          const webcamVideo = document.createElement("video");
          webcamVideo.srcObject = webcamStream;
          webcamVideo.muted = true;
          webcamVideo.playsInline = true;
          webcamVideo.play();

          if (webcamVideo.readyState >= 2) {
            ctx.drawImage(
              webcamVideo,
              webcamX,
              webcamY,
              webcamDisplayWidth,
              webcamDisplayHeight,
            );

            ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
            ctx.beginPath();
            ctx.roundRect(
              webcamX - 2,
              webcamY - 2,
              webcamDisplayWidth + 4,
              webcamDisplayHeight + 4,
              8,
            );
            ctx.fill();
          }
        }

        if (includeAnnotations && this.app.annotationManager?.isActive) {
          const annotationCanvas = this.app.annotationManager.getCanvas();
          const tempCanvas = this.app.annotationManager.getTempCanvas();

          ctx.drawImage(annotationCanvas, 0, 0, width, height);
          ctx.drawImage(tempCanvas, 0, 0, width, height);
        }
      } catch (err) {
        console.error("Compositor frame draw error:", err);
      }

      if (this.isRecording && this.compositorDrawId) {
        this.compositorDrawId = requestAnimationFrame(drawFrame);
      }
    };

    // Start RAF-driven drawing loop
    this.compositorDrawId = requestAnimationFrame(drawFrame);

    // Capture stream from offscreen canvas
    const captureStream = offscreenCanvas.captureStream(frameRate);

    const finalStream = new MediaStream([
      ...captureStream.getVideoTracks(),
      ...audioTracks,
    ]);

    // Store offscreenCanvas for cleanup
    this.compositorOffscreenCanvas = offscreenCanvas;

    return finalStream;
  }

  getSupportedMimeType() {
    const types = [
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm",
      "video/mp4",
    ];

    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) {
        return type;
      }
    }

    return "video/webm";
  }

  getVideoBitrate() {
    switch (this.app.settings.videoQuality) {
      case "low":
        return 1000000;
      case "medium":
        return 2500000;
      case "high":
        return 5000000;
      case "ultra":
        return 10000000;
      default:
        return 5000000;
    }
  }

  startRecordingTimer() {
    this.recordingTimer = setInterval(() => {
      const elapsed = Date.now() - this.recordingStartTime;
      this.app.recordingTime.textContent = this.formatTime(elapsed);
      if (this.app.pillTime) {
        const totalSeconds = Math.floor(elapsed / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        this.app.pillTime.textContent = `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
      }
      this.updateRecordingStats();
    }, 1000);
  }

  updateRecordingStats() {
    if (!this.selectedSource) return;

    const resolution = this.app.settings.resolution || "1920x1080";
    const frameRate = this.app.settings.frameRate || 24;
    const resLabel =
      resolution === "1920x1080"
        ? "1080p"
        : resolution === "1280x720"
          ? "720p"
          : resolution === "2560x1440"
            ? "1440p"
            : resolution === "3840x2160"
              ? "4K"
              : resolution;

    const estimatedFps = frameRate;
    const sizeStr = this.app.formatFileSize(this.recordedBytes);

    if (this.app.statFps) this.app.statFps.textContent = estimatedFps;
    if (this.app.statSize) this.app.statSize.textContent = sizeStr;
    if (this.app.statRes) this.app.statRes.textContent = resLabel;
  }

  formatTime(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return [hours, minutes, seconds]
      .map((v) => v.toString().padStart(2, "0"))
      .join(":");
  }

  startAudioMeter() {
    if (!this.audioStream) return;

    this.app.audioMeter?.classList.remove("hidden");

    try {
      this.audioContext = new (
        window.AudioContext || window.webkitAudioContext
      )();
      this.audioAnalyser = this.audioContext.createAnalyser();
      this.audioAnalyser.fftSize = 64;

      const source = this.audioContext.createMediaStreamSource(
        this.audioStream,
      );
      source.connect(this.audioAnalyser);

      const bufferLength = this.audioAnalyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const updateMeter = () => {
        if (!this.isRecording || !this.audioAnalyser) return;

        this.audioAnalyser.getByteFrequencyData(dataArray);

        const bars = this.app.audioMeterBars?.querySelectorAll(".audio-bar");
        if (!bars) return;

        const step = Math.floor(bufferLength / bars.length);

        bars.forEach((bar, index) => {
          const value = dataArray[index * step] || 0;
          const height = Math.max(4, (value / 255) * 20);

          bar.style.height = `${height}px`;

          bar.classList.remove("active", "medium", "high");
          if (value > 0) {
            bar.classList.add("active");
            if (value > 180) {
              bar.classList.add("high");
            } else if (value > 100) {
              bar.classList.add("medium");
            }
          }
        });

        this.audioAnimationId = requestAnimationFrame(updateMeter);
      };

      updateMeter();
    } catch (err) {
      console.warn("Audio meter initialization failed:", err);
    }
  }

  stopAudioMeter() {
    if (this.audioAnimationId) {
      cancelAnimationFrame(this.audioAnimationId);
      this.audioAnimationId = null;
    }

    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    this.audioAnalyser = null;
    this.app.audioMeter?.classList.add("hidden");

    const bars = this.app.audioMeterBars?.querySelectorAll(".audio-bar");
    bars?.forEach((bar) => {
      bar.style.height = "4px";
      bar.classList.remove("active", "medium", "high");
    });
  }

  async startRecording() {
    if (this.isRecording) {
      this.app.showToast("Recording already in progress", "error");
      return;
    }

    if (!this.selectedSource && !this.selectedRegion) {
      this.app.showToast("Please select a screen or region first", "error");
      return;
    }

    if (
      this.selectedSource &&
      (!this.videoStream || !this.videoStream.active)
    ) {
      this.app.showToast(
        "Source stream is no longer active. Please select source again.",
        "error",
      );
      return;
    }

    if (
      this.selectedRegion &&
      this.selectedRegion.width &&
      this.selectedRegion.height
    ) {
      await this.setupRegionStream(true);
      if (!this.videoStream) {
        this.app.showToast("Failed to capture region", "error");
        return;
      }
    }

    const countdownSeconds = this.app.settings.countdown || 0;

    if (countdownSeconds > 0) {
      const cancelled = await this.app.runCountdown(countdownSeconds);
      if (cancelled) return;
    }

    try {
      this.recordedChunks = [];
      this.recordedBytes = 0;
      this.chunkFiles = [];
      this.app.startBtn.disabled = true;
      this.app.selectSourceBtn.disabled = true;
      this.app.pauseBtn.disabled = true;
      this.app.stopBtn.disabled = true;
      this.app.startBtn.textContent = "Starting...";

      if (document.getElementById("settingsRecordAudio").checked) {
        await this.setupAudioStream();
      }

      if (this.app.settings.recordAudio && this.audioStream) {
        this.startAudioMeter();
      }

      let videoTracks;
      let audioTracks;
      try {
        videoTracks = this.videoStream.getTracks();
        audioTracks = this.audioStream ? this.audioStream.getTracks() : [];
      } catch (trackErr) {
        console.error("Failed to get tracks:", trackErr);
        throw new Error("Failed to access media tracks");
      }

      if (videoTracks.length === 0) {
        throw new Error("No video tracks available");
      }

      const webcamEnabled =
        this.app.settings.webcamEnabled ||
        document.getElementById("settingsWebcam")?.checked;

      if (webcamEnabled) {
        try {
          const devices = await navigator.mediaDevices.enumerateDevices();
          const videoDevices = devices.filter((d) => d.kind === "videoinput");

          if (videoDevices.length === 0) {
            this.app.showToast("No camera found", "error");
          } else {
            const cameraId =
              this.app.settings.selectedCamera ||
              document.getElementById("settingsCamera")?.value;

            let constraints = {
              audio: false,
              video: {},
            };

            if (
              cameraId &&
              cameraId !== "default" &&
              videoDevices.find((d) => d.deviceId === cameraId)
            ) {
              constraints.video.deviceId = { exact: cameraId };
            }

            this.webcamStream =
              await navigator.mediaDevices.getUserMedia(constraints);
            this.app.showToast("Webcam enabled", "info");
          }
        } catch (webcamErr) {
          console.error(
            "Webcam error details:",
            webcamErr.message,
            webcamErr.name,
          );
          if (webcamErr.name === "NotReadableError") {
            this.app.showToast(
              "Webcam in use by another app - close other apps using camera",
              "error",
            );
          } else if (webcamErr.name === "NotAllowedError") {
            this.app.showToast("Webcam permission denied", "error");
          } else {
            this.app.showToast(
              "Webcam unavailable, recording screen only",
              "info",
            );
          }
        }
      }

      try {
        const annotationsActive = this.app.annotationManager?.isActive;

        if (this.webcamStream) {
          this.mixedStream = await this.createCompositedStream(
            videoTracks,
            audioTracks,
            annotationsActive,
          );
        } else if (annotationsActive) {
          this.mixedStream = await this.createCompositedStream(
            videoTracks,
            audioTracks,
            true,
          );
        } else {
          this.mixedStream = new MediaStream([...videoTracks, ...audioTracks]);
        }
      } catch (streamErr) {
        console.error("Failed to create mixed stream:", streamErr);
        throw new Error("Failed to create recording stream");
      }

      const mimeType = this.getSupportedMimeType();

      if (!mimeType) {
        throw new Error("No supported video format available");
      }

      try {
        this.mediaRecorder = new MediaRecorder(this.mixedStream, {
          mimeType,
          videoBitsPerSecond: this.getVideoBitrate(),
        });
      } catch (recorderErr) {
        console.error("Failed to create media recorder:", recorderErr);
        throw new Error("Failed to initialize recorder");
      }

      try {
        await this.startChunkedRecording({ mimeType });
      } catch (startErr) {
        console.warn(
          "Failed to initialize chunked recording session:",
          startErr,
        );
      }

      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          this.recordedBytes += e.data.size;

          // Update performance monitor with file size metrics
          if (this.monitor) {
            this.monitor.setRecordingFileSize(this.recordedBytes);
          }

          const currentMemory = this.estimateMemoryUsage();

          if (currentMemory > this.maxMemoryBytes * 1.2) {
            if (!this.warnedAboutMemory) {
              this.warnedAboutMemory = true;
              this.app.showToast(
                "Memory threshold reached. Saving partial recording...",
                "warning",
              );
            }
            this.handleRecordingComplete(true);
            return;
          }

          try {
            e.data
              .arrayBuffer()
              .then((ab) => {
                try {
                  if (this.chunkSessionId) {
                    const startTime = Date.now();
                    window.electronAPI.appendRecordingChunk(
                      this.chunkSessionId,
                      ab,
                    );
                    const latency = Date.now() - startTime;

                    // Track IPC latency for performance analysis
                    if (this.monitor) {
                      this.monitor.recordIPCLatency(latency);
                    }
                  }
                } catch (ipcErr) {
                  console.error("appendRecordingChunk failed:", ipcErr);
                }
              })
              .catch((arrErr) =>
                console.error("Failed to read chunk arrayBuffer:", arrErr),
              );
          } catch (err) {
            console.error("ondataavailable error:", err);
          }
        }
      };

      this.mediaRecorder.onstop = () => this.handleRecordingComplete();

      this.mediaRecorder.start(100);
      this.isRecording = true;
      this.recordingStartTime = Date.now();

      // Start performance monitoring
      this.monitor.startRecording();

      try {
        await window.electronAPI.setRecordingState(true);
      } catch (ipcErr) {
        console.warn(
          "Failed to notify main process about recording start:",
          ipcErr,
        );
      }

      this.app.updateUIForRecording();
      this.startRecordingTimer();

      if (this.app.timerPreset > 0) {
        const durationMs = this.app.timerPreset * 60 * 1000;
        this.recordingTimeout = setTimeout(() => {
          if (this.isRecording) {
            this.app.showToast(
              `Recording auto-stopped after ${this.app.timerPreset} minutes`,
              "info",
            );
            this.stopRecording();
          }
        }, durationMs);
        this.app.showToast(
          `Recording will auto-stop in ${this.app.timerPreset} minutes`,
          "info",
        );
      }

      if (this.app.settings.hideWindowDuringRecording) {
        try {
          await window.electronAPI.windowMinimize();
        } catch (minErr) {
          console.warn("Failed to minimize window:", minErr);
        }
      }

      this.app.showToast("Recording started", "info");
    } catch (err) {
      this.app.showToast(`Failed to start: ${err.message}`, "error");
      console.error(err);
    }
  }

  async stopRecording() {
    if (!this.isRecording || !this.mediaRecorder) return;

    try {
      if (this.recordingTimeout) {
        clearTimeout(this.recordingTimeout);
        this.recordingTimeout = null;
      }

      this.stopChunkedRecording();
      this.mediaRecorder.stop();
      this.isRecording = false;

      if (this.recordingTimer) {
        clearInterval(this.recordingTimer);
        this.recordingTimer = null;
      }

      this.app.updateUIForStopped();
      try {
        await window.electronAPI.setRecordingState(false);
      } catch (ipcErr) {
        console.warn(
          "Failed to notify main process about recording stop:",
          ipcErr,
        );
      }

      this.app.processingOverlay.classList.add("active");
      this.app.processingTitle.textContent = "Processing Recording";
      this.app.processingStatus.textContent = "Saving and converting...";
      this.app.processingStartTime = Date.now();
      this.app.progressFill.style.width = "0%";
      this.app.progressPercent.textContent = "0%";
      this.app.progressEta.textContent = "Calculating...";
    } catch (err) {
      this.app.showToast(`Failed to stop: ${err.message}`, "error");
      console.error(err);
    }
  }

  pauseRecording() {
    if (!this.mediaRecorder || this.isPaused) return;

    try {
      this.mediaRecorder.pause();
      this.isPaused = true;

      if (this.recordingTimer) {
        clearInterval(this.recordingTimer);
        this.recordingTimer = null;
      }

      this.app.updateUIPaused();
      this.app.showToast("Recording paused", "info");

      window.electronAPI
        .setRecordingState(true, true)
        .catch((err) => console.warn("setRecordingState(pause) failed:", err));
    } catch (err) {
      console.error("Failed to pause:", err);
      this.app.showToast(`Failed to pause: ${err.message}`, "error");
    }
  }

  resumeRecording() {
    if (!this.mediaRecorder || !this.isPaused) return;

    try {
      this.mediaRecorder.resume();
      this.isPaused = false;

      this.recordingStartTime = Date.now();
      this.startRecordingTimer();

      this.app.updateUIForRecording();
      this.app.showToast("Recording resumed", "info");

      window.electronAPI
        .setRecordingState(true, false)
        .catch((err) => console.warn("setRecordingState(resume) failed:", err));
    } catch (err) {
      console.error("Failed to resume:", err);
      this.app.showToast(`Failed to resume: ${err.message}`, "error");
    }
  }

  async startChunkedRecording(options = {}) {
    this.maxMemoryBytes = 500 * 1024 * 1024;
    this.warnedAboutMemory = false;

    try {
      const res = await window.electronAPI
        .startChunkedRecording(options)
        .catch((e) => {
          console.warn("startChunkedRecording IPC failed:", e);
          return null;
        });
      if (res && res.sessionId) {
        this.chunkSessionId = res.sessionId;
        this.tempChunkPath = res.tempFilePath;
      } else {
        console.warn("Chunked recording session not created");
      }
    } catch (err) {
      console.warn("Failed to start chunked session:", err);
    }

    this.chunkInterval = setInterval(async () => {
      if (!this.isRecording || this.isPaused) return;

      const memoryUsage = this.estimateMemoryUsage();

      if (memoryUsage > this.maxMemoryBytes && !this.warnedAboutMemory) {
        this.warnedAboutMemory = true;
        this.app.showToast(
          "Warning: Recording is using significant memory. Consider stopping soon.",
          "warning",
        );
      }

      if (memoryUsage > this.maxMemoryBytes * 1.5) {
        this.app.showToast(
          "Memory limit reached. Stopping recording to prevent crash.",
          "error",
        );
        await this.stopRecording();
      }
    }, 5000);
  }

  estimateMemoryUsage() {
    return this.recordedBytes || 0;
  }

  stopChunkedRecording() {
    if (this.chunkInterval) {
      clearInterval(this.chunkInterval);
      this.chunkInterval = null;
    }
  }

  async handleRecordingComplete(isPartial = false) {
    // Stop performance monitoring
    if (this.monitor) {
      this.monitor.stopRecording();
    }

    try {
      let settings;
      try {
        settings = await window.electronAPI.getSettings();
      } catch (settingsErr) {
        console.error("Failed to get settings:", settingsErr);
        settings = {};
      }

      let result;

      if (this.chunkSessionId) {
        try {
          result = await window.electronAPI.finalizeChunkedRecording(
            this.chunkSessionId,
            { isPartial },
          );
        } catch (finalErr) {
          throw new Error(
            `Failed to finalize chunked recording: ${finalErr.message}`,
          );
        }
      } else {
        const blob = new Blob(this.recordedChunks, {
          type: this.getSupportedMimeType(),
        });
        let arrayBuffer;
        try {
          arrayBuffer = await blob.arrayBuffer();
        } catch (bufferErr) {
          throw new Error(
            `Failed to convert blob to array buffer: ${bufferErr.message}`,
          );
        }

        try {
          result = await window.electronAPI.saveRecording(
            arrayBuffer,
            this.chunkFiles,
          );
        } catch (saveErr) {
          throw new Error(`IPC call failed: ${saveErr.message}`);
        }
      }

      // clear session id after finalize attempt
      this.chunkSessionId = null;
      this.tempChunkPath = null;

      if (!result) {
        throw new Error("No response from save recording handler");
      }

      if (result.canceled) {
        this.app.processingOverlay.classList.remove("active");
        this.app.showToast("Recording cancelled", "info");
        return;
      }

      if (!result.success) {
        this.app.processingOverlay.classList.remove("active");
        this.app.showToast(result.error || "Failed to save recording", "error");
        return;
      }

      if (result.backgroundProcessing) {
        this.app.processingTitle.textContent = "Processing Video";
        this.app.processingStatus.textContent = "Converting to MP4...";
        this.app.processingStartTime = Date.now();
        this.app.progressFill.style.width = "0%";
        this.app.progressPercent.textContent = "0%";
        this.app.progressEta.textContent = "Starting...";
        this.app.processingOverlay.classList.add("active");
        this.app.showToast("Video is being converted in background", "info");
      } else {
        const message = isPartial
          ? "Recording saved (partial - memory limit reached)!"
          : "Recording saved!";
        this.app.processingOverlay.classList.remove("active");
        this.app.showToast(message, isPartial ? "warning" : "success");

        if (settings.autoOpenAfterRecording && result.filePath) {
          try {
            await window.electronAPI.openFile(result.filePath);
          } catch (openErr) {
            console.warn("Failed to open file:", openErr);
          }
        }
        this.app.showCompletionOptions(result.filePath);
      }
    } catch (err) {
      try {
        if (this.chunkSessionId) {
          await window.electronAPI
            .abortChunkedRecording(this.chunkSessionId)
            .catch((_) => {});
          this.chunkSessionId = null;
          this.tempChunkPath = null;
        }
      } catch (abortErr) {
        console.warn("Failed to abort chunk session:", abortErr);
      }

      this.app.processingOverlay.classList.remove("active");
      this.app.showToast(`Error: ${err.message}`, "error");
      console.error("handleRecordingComplete error:", err);
      console.error(err);
    }

    if (this.mixedStream) {
      this.mixedStream.getTracks().forEach((track) => track.stop());
      this.mixedStream = null;
    }

    this.recordedChunks = [];
    this.recordedBytes = 0;
  }
}

window.RecordingManager = RecordingManager;

window.RecordingManager = RecordingManager;
