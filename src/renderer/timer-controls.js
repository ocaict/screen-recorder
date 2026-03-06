class TimerControls {
  constructor(app) {
    this.app = app;
    this.timerPreset = 0;
    this.recordingTimeout = null;
  }

  formatFileSize(bytes) {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  }

  updateFileSizeEstimate() {
    const getEl = (id) => this.app.document.getElementById(id);
    const quality = getEl("settingsQuality")?.value || "high";
    const resolution = getEl("settingsResolution")?.value || "1920x1080";
    const frameRate = parseInt(getEl("settingsFrameRate")?.value || "30");
    const recordAudio = getEl("settingsRecordAudio")?.checked !== false;

    const parseRes = resolution === "native" ? "1920x1080" : resolution;
    const [width, height] = parseRes.split("x").map(Number);
    const pixels = width * height;
    const pixelsPerSecond = pixels * frameRate;

    let bitrateMultiplier;
    switch (quality) {
      case "low": bitrateMultiplier = 0.1; break;
      case "medium": bitrateMultiplier = 0.25; break;
      case "high": bitrateMultiplier = 0.5; break;
      case "ultra": bitrateMultiplier = 1.0; break;
      default: bitrateMultiplier = 0.5;
    }

    let videoBitrate = (pixelsPerSecond * bitrateMultiplier) / 8;
    const recordSystemAudio = getEl("settingsRecordSystemAudio")?.checked;
    let audioBitrate = recordAudio || recordSystemAudio ? (128 * 1024) / 8 : 0;

    const totalBitratePerSecond = videoBitrate + audioBitrate;
    const durationSeconds = 60;
    const estimatedBytes = totalBitratePerSecond * durationSeconds;

    const sizeValue = this.app.fileSizePreview?.querySelector(".size-value");
    if (sizeValue) {
      sizeValue.textContent = `~${this.formatFileSize(estimatedBytes)}`;
    }
  }

  formatSeconds(seconds) {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (hrs > 0) {
      return `${hrs}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
    }
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  }

  timeToSeconds(timeStr) {
    const parts = timeStr.split(":").map(Number);
    if (parts.length === 3) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    } else if (parts.length === 2) {
      return parts[0] * 60 + parts[1];
    }
    return 0;
  }

  async runCountdown(seconds) {
    return new Promise((resolve) => {
      const overlay = this.app.countdownOverlay;
      const numberEl = this.app.countdownNumber;
      if (!overlay || !numberEl) {
        resolve();
        return;
      }

      overlay.classList.add("active");
      numberEl.textContent = seconds;

      const tick = () => {
        seconds--;
        if (seconds > 0) {
          numberEl.textContent = seconds;
        } else {
          overlay.classList.remove("active");
          resolve();
        }
      };

      const interval = setInterval(tick, 1000);
      setTimeout(() => clearInterval(interval), seconds * 1000);
    });
  }

  startTimerPreset() {
    if (this.timerPreset > 0) {
      const durationSeconds = this.timerPreset * 60;
      this.recordingTimeout = setTimeout(() => {
        if (this.app.recordingManager?.isRecording) {
          this.app.recordingManager.stopRecording();
          this.app.showToast(`Recording stopped after ${this.timerPreset} minutes`, "info");
        }
      }, durationSeconds * 1000);
    }
  }

  clearTimerPreset() {
    if (this.recordingTimeout) {
      clearTimeout(this.recordingTimeout);
      this.recordingTimeout = null;
    }
  }
}
