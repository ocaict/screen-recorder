class ScreenRecorder {
  constructor() {
    this.videoStream = null;
    this.audioStream = null;
    this.mixedStream = null;
    this.mediaRecorder = null;
    this.recordedChunks = [];
    this.isRecording = false;
    this.isPaused = false;
    this.selectedSource = null;
    this.selectedAudioDevice = null;
    this.recordingStartTime = null;
    this.recordingTimer = null;
    this.settings = {};

    this.initializeElements();
    this.initializeEventListeners();
    this.initializeIPCListeners();
    this.loadSettings();
    this.loadAudioDevices();
  }

  initializeElements() {
    this.previewVideo = document.getElementById("previewVideo");
    this.noSourceMessage = document.getElementById("noSourceMessage");
    this.recordingIndicator = document.getElementById("recordingIndicator");
    this.recordingTime = document.getElementById("recordingTime");
    this.selectSourceBtn = document.getElementById("selectSourceBtn");
    this.startBtn = document.getElementById("startBtn");
    this.pauseBtn = document.getElementById("pauseBtn");
    this.pauseIcon = document.getElementById("pauseIcon");
    this.resumeIcon = document.getElementById("resumeIcon");
    this.pauseBtnText = document.getElementById("pauseBtnText");
    this.stopBtn = document.getElementById("stopBtn");
    this.sourceModal = document.getElementById("sourceModal");
    this.sourceGrid = document.getElementById("sourceGrid");
    this.closeSourceModal = document.getElementById("closeSourceModal");
    this.settingsModal = document.getElementById("settingsModal");
    this.closeSettingsModal = document.getElementById("closeSettingsModal");
    this.settingsBtn = document.getElementById("settingsBtn");
    this.saveSettingsBtn = document.getElementById("saveSettingsBtn");
    this.toastContainer = document.getElementById("toastContainer");
    this.processingOverlay = document.getElementById("processingOverlay");
    this.progressFill = document.getElementById("progressFill");
    this.progressPercent = document.getElementById("progressPercent");
    this.processingText = document.getElementById("processingText");
    this.sourceList = document.getElementById("sourceList");
    this.minimizeBtn = document.getElementById("minimizeBtn");
    this.maximizeBtn = document.getElementById("maximizeBtn");
    this.closeBtn = document.getElementById("closeBtn");
    this.countdownOverlay = document.getElementById("countdownOverlay");
    this.countdownNumber = document.getElementById("countdownNumber");
    this.recentRecordingsList = document.getElementById("recentRecordingsList");
    this.clearRecentBtn = document.getElementById("clearRecentBtn");
    this.hotkeyOverlay = document.getElementById("hotkeyOverlay");
    this.hotkeyKey = document.getElementById("hotkeyKey");
    this.hwInfo = document.getElementById("hardwareInfo");
    this.hwAutoBtn = document.getElementById("autoSelectNvenc");
    this.nvencPrompt = document.getElementById("nvencPrompt");
    this.nvencEnableBtn = document.getElementById("nvencEnableBtn");
    this.nvencDismissBtn = document.getElementById("nvencDismissBtn");
  }

  initializeEventListeners() {
    this.selectSourceBtn.addEventListener("click", () =>
      this.openSourceModal(),
    );
    this.startBtn.addEventListener("click", () => this.startRecording());
    this.pauseBtn.addEventListener("click", () => this.togglePause());
    this.stopBtn.addEventListener("click", () => this.stopRecording());
    this.closeSourceModal.addEventListener("click", () =>
      this.closeModal(this.sourceModal),
    );
    this.closeSettingsModal.addEventListener("click", () =>
      this.closeModal(this.settingsModal),
    );
    this.settingsBtn.addEventListener("click", () => this.openSettingsModal());
    this.saveSettingsBtn.addEventListener("click", () => this.saveSettings());
    if (this.hwAutoBtn) {
      this.hwAutoBtn.addEventListener("click", async () => {
        const hwSelect = document.getElementById(
          "settingsHardwareAcceleration",
        );
        if (this.availableEncoders && this.availableEncoders.nvenc) {
          hwSelect.value = "nvenc";
          this.showToast("NVENC selected. Click Save to apply.", "info");
        } else {
          this.showToast("NVENC not available on this system.", "error");
        }
      });
    }
    if (this.clearRecentBtn) {
      this.clearRecentBtn.addEventListener("click", async () => {
        if (
          !confirm(
            "Clear all recent recordings? This will only remove them from the list.",
          )
        )
          return;
        try {
          await window.electronAPI.clearRecentRecordings();
          await this.loadRecentRecordings();
          this.showToast("Recent recordings cleared", "info");
        } catch (err) {
          this.showToast("Failed to clear recent recordings", "error");
        }
      });
    }
    if (this.nvencEnableBtn) {
      this.nvencEnableBtn.addEventListener("click", async () => {
        try {
          await window.electronAPI.saveSettings({
            hardwareAcceleration: "nvenc",
          });
          this.settings.hardwareAcceleration = "nvenc";
          this.applySettings();
          this.showToast(
            "NVENC enabled. Exports will use hardware encoding when available.",
            "success",
          );
          if (this.nvencPrompt) this.nvencPrompt.style.display = "none";
        } catch (err) {
          this.showToast("Failed to enable NVENC", "error");
        }
      });
    }
    if (this.nvencDismissBtn) {
      this.nvencDismissBtn.addEventListener("click", async () => {
        try {
          await window.electronAPI.saveSettings({ nvencPromptDismissed: true });
          this.settings.nvencPromptDismissed = true;
          if (this.nvencPrompt) this.nvencPrompt.style.display = "none";
        } catch (err) {
          this.showToast("Failed to dismiss prompt", "error");
        }
      });
    }
    this.minimizeBtn.addEventListener("click", () =>
      window.electronAPI.windowMinimize(),
    );
    this.maximizeBtn.addEventListener("click", () => this.toggleMaximize());
    this.closeBtn.addEventListener("click", () =>
      window.electronAPI.windowClose(),
    );

    this.sourceModal.addEventListener("click", (e) => {
      if (e.target === this.sourceModal) this.closeModal(this.sourceModal);
    });
    this.settingsModal.addEventListener("click", (e) => {
      if (e.target === this.settingsModal) this.closeModal(this.settingsModal);
    });

    document.querySelectorAll(".settings-tab").forEach((tab) => {
      tab.addEventListener("click", () => this.switchTab(tab.dataset.tab));
    });
  }

  switchTab(tabName) {
    document
      .querySelectorAll(".settings-tab")
      .forEach((t) => t.classList.remove("active"));
    document
      .querySelectorAll(".tab-content")
      .forEach((c) => c.classList.remove("active"));
    document
      .querySelector(`.settings-tab[data-tab="${tabName}"]`)
      .classList.add("active");
    document.getElementById(`tab-${tabName}`).classList.add("active");
  }

  initializeIPCListeners() {
    window.electronAPI.onStopRecordingFromTray(() => {
      if (this.isRecording) this.stopRecording();
    });

    window.electronAPI.onStopRecordingFromShortcut(() => {
      if (
        this.mediaRecorder &&
        (this.mediaRecorder.state === "recording" ||
          this.mediaRecorder.state === "paused")
      ) {
        this.stopRecording();
      } else if (this.isRecording || this.mediaRecorder) {
        this.stopRecording();
      }
    });

    window.electronAPI.onResumeRecordingFromTray(() => {
      if (this.isRecording && this.isPaused) this.resumeRecording();
    });

    window.electronAPI.onPauseRecordingFromTray(() => {
      if (this.isRecording && !this.isPaused) this.pauseRecording();
    });

    window.electronAPI.onStopRecordingFromQuit(async () => {
      if (this.isRecording) {
        await this.stopRecording();
        await new Promise((resolve) => setTimeout(resolve, 1000));
        window.electronAPI.windowClose();
      }
    });

    window.electronAPI.onConversionStarted(() => {
      this.processingText.textContent = "Converting video...";
    });

    window.electronAPI.onConversionProgress((progress) => {
      if (progress && progress.warning) {
        this.showToast(progress.warning, "warning");
        this.processingText.textContent = "Converting (software fallback)";
        return;
      }

      this.progressFill.style.width = `${progress.percent || 0}%`;
      this.progressPercent.textContent = `${Math.round(progress.percent || 0)}%`;
    });

    window.electronAPI.onConversionComplete(async (filePath) => {
      this.processingOverlay.classList.remove("active");
      this.showToast("Recording saved successfully!", "success");

      const settings = await window.electronAPI.getSettings();
      if (settings.autoOpenAfterRecording) {
        window.electronAPI.openFile(filePath);
      }

      await this.loadRecentRecordings();
      this.showCompletionOptions(filePath);
    });

    window.electronAPI.onError((error) => {
      this.processingOverlay.classList.remove("active");
      this.showToast(error.message || "An error occurred", "error");
    });
  }

  async loadSettings() {
    try {
      this.settings = await window.electronAPI.getSettings();
      this.applySettings();
      await this.loadRecentRecordings();
    } catch (err) {
      console.error("Failed to load settings:", err);
    }
  }

  async loadRecentRecordings() {
    try {
      const recordings = await window.electronAPI.getRecentRecordings();
      this.displayRecentRecordings(recordings);
    } catch (err) {
      console.error("Failed to load recent recordings:", err);
    }
  }

  displayRecentRecordings(recordings) {
    if (!recordings || recordings.length === 0) {
      this.recentRecordingsList.innerHTML =
        '<div class="no-recordings">No recordings yet</div>';
      return;
    }

    const limitedRecordings = recordings.slice(0, 10);

    this.recentRecordingsList.innerHTML = limitedRecordings
      .map((recording) => {
        const date = new Date(recording.recordedAt);
        const dateStr =
          date.toLocaleDateString() +
          " " +
          date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        const sizeStr = this.formatFileSize(recording.size);

        return `
        <div class="recent-recording-item" data-path="${recording.filePath}" title="${recording.filePath}">
          <svg class="recent-recording-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polygon points="5,3 19,12 5,21"/>
          </svg>
          <div class="recent-recording-info">
            <div class="recent-recording-name">${recording.fileName}</div>
            <div class="recent-recording-date">${dateStr} • ${sizeStr}</div>
          </div>
          <div class="recent-recording-actions">
            <button class="btn btn-icon btn-delete" data-path="${recording.filePath}" title="Remove">✕</button>
          </div>
        </div>
      `;
      })
      .join("");

    this.recentRecordingsList
      .querySelectorAll(".recent-recording-item")
      .forEach((item) => {
        item.addEventListener("click", (e) => {
          // ignore clicks on action buttons
          if (e.target.closest(".btn-delete")) return;
          const filePath = item.dataset.path;
          window.electronAPI.openFile(filePath);
        });
      });

    this.recentRecordingsList.querySelectorAll(".btn-delete").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const filePath = btn.dataset.path;
        if (!confirm("Remove this recording from recent list?")) return;

        const deleteFile = confirm(
          "Also delete the file from disk? This is irreversible.",
        );

        try {
          if (deleteFile) {
            const res =
              await window.electronAPI.removeRecentRecordingAndFile(filePath);
            if (!res || res.success === false) {
              this.showToast(
                `Failed to delete file: ${res && res.error ? res.error : "unknown"}`,
                "error",
              );
            } else {
              this.showToast("Recording deleted", "success");
            }
          } else {
            await window.electronAPI.removeRecentRecording(filePath);
            this.showToast("Recording removed", "info");
          }

          await this.loadRecentRecordings();
        } catch (err) {
          this.showToast("Failed to remove recording", "error");
        }
      });
    });
  }

  formatFileSize(bytes) {
    if (!bytes || bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  }

  applySettings() {
    document.getElementById("settingsQuality").value =
      this.settings.videoQuality || "high";
    document.getElementById("settingsFrameRate").value =
      this.settings.frameRate || "30";
    document.getElementById("settingsResolution").value =
      this.settings.resolution || "1920x1080";
    document.getElementById("settingsRecordAudio").checked =
      this.settings.recordAudio !== false;
    document.getElementById("settingsCountdown").value =
      this.settings.countdown || "5";
    document.getElementById("settingsOutputDir").value =
      this.settings.outputDirectory || "";
    document.getElementById("settingsFilenamePattern").value =
      this.settings.filenamePattern || "Recording_{date}_{time}";
    document.getElementById("settingsAutoSave").checked =
      this.settings.autoSave || false;
    document.getElementById("settingsAutoOpen").checked =
      this.settings.autoOpen !== false;
    document.getElementById("settingsHideWindow").checked =
      this.settings.hideWindowDuringRecording !== false;
    document.getElementById("settingsShortcut").checked =
      this.settings.shortcutEnabled !== false;
    document.getElementById("settingsShortcutKey").value =
      this.settings.shortcutKey || "F9";
  }

  async loadAudioDevices() {
    // Audio devices are now loaded via settings modal
  }

  async openSourceModal() {
    try {
      this.sourceGrid.innerHTML =
        '<div class="loading">Loading sources...</div>';
      this.sourceModal.classList.add("active");

      const sources = await window.electronAPI.getCaptureSources();
      this.displaySources(sources);
    } catch (err) {
      this.showToast("Failed to get sources", "error");
      console.error(err);
    }
  }

  displaySources(sources) {
    this.sourceGrid.innerHTML = "";

    if (sources.length === 0) {
      this.sourceGrid.innerHTML =
        '<div class="no-sources">No sources available</div>';
      return;
    }

    sources.forEach((source) => {
      const item = document.createElement("div");
      item.className = "source-grid-item";
      item.dataset.id = source.id;

      const img = document.createElement("img");
      img.src = source.thumbnail;
      img.alt = source.name;

      const label = document.createElement("div");
      label.className = "source-label";
      label.textContent = source.name;

      item.appendChild(img);
      item.appendChild(label);

      item.addEventListener("click", () => this.selectSource(source, item));

      this.sourceGrid.appendChild(item);
    });
  }

  async selectSource(source, element) {
    document
      .querySelectorAll(".source-grid-item")
      .forEach((el) => el.classList.remove("selected"));
    element.classList.add("selected");

    this.selectedSource = source;
    await this.setupVideoStream(source);
    this.updateSourcePreview(source);
    this.closeModal(this.sourceModal);
    this.startBtn.disabled = false;
  }

  updateSourcePreview(source) {
    const sourceList = document.getElementById("sourceList");
    sourceList.innerHTML = `
      <div class="source-item active">
        <img src="${source.thumbnail}" alt="${source.name}" class="source-thumbnail">
        <span class="source-name">${source.name}</span>
      </div>
    `;
  }

  async setupVideoStream(source) {
    try {
      this.stopCurrentStream();

      this.videoStream = await navigator.mediaDevices.getUserMedia({
        video: {
          mandatory: {
            chromeMediaSource: "desktop",
            chromeMediaSourceId: source.id,
            minWidth: 1920,
            maxWidth: 1920,
            minHeight: 1080,
            maxHeight: 1080,
            minFrameRate: 30,
            maxFrameRate: 30,
          },
        },
        audio: false,
      });

      this.previewVideo.srcObject = this.videoStream;
      this.previewVideo.play();
      this.noSourceMessage.classList.add("hidden");

      this.showToast("Source connected", "success");
    } catch (err) {
      this.showToast(`Failed to connect: ${err.message}`, "error");
      console.error(err);
    }
  }

  runCountdown(seconds) {
    return new Promise((resolve) => {
      this.countdownOverlay.classList.remove("hidden");
      this.countdownNumber.textContent = seconds;

      let remaining = seconds;
      let cancelled = false;

      const originalStopRecording = this.stopRecording.bind(this);

      const countdownInterval = setInterval(() => {
        remaining--;

        if (remaining <= 0) {
          clearInterval(countdownInterval);
          this.countdownOverlay.classList.add("hidden");
          this.stopRecording = originalStopRecording;
          resolve(false);
        } else {
          this.countdownNumber.textContent = remaining;
        }
      }, 1000);

      this._countdownCancelled = false;

      this.stopRecording = () => {
        cancelled = true;
        clearInterval(countdownInterval);
        this.countdownOverlay.classList.add("hidden");
        this._countdownCancelled = true;
        this.stopRecording = originalStopRecording;
        this.showToast("Countdown cancelled", "info");
        this.startBtn.disabled = false;
        this.selectSourceBtn.disabled = false;
        this.startBtn.textContent = "Start Recording";
      };
    }).then((cancelled) => {
      return cancelled;
    });
  }

  stopCurrentStream() {
    if (this.videoStream) {
      this.videoStream.getTracks().forEach((track) => track.stop());
      this.videoStream = null;
    }
    if (this.audioStream) {
      this.audioStream.getTracks().forEach((track) => track.stop());
      this.audioStream = null;
    }
    this.previewVideo.srcObject = null;
  }

  async startRecording() {
    if (this.isRecording) {
      this.showToast("Recording already in progress", "error");
      return;
    }

    if (!this.selectedSource) {
      this.showToast("Please select a screen or window first", "error");
      return;
    }

    if (!this.videoStream || !this.videoStream.active) {
      this.showToast(
        "Source stream is no longer active. Please select source again.",
        "error",
      );
      return;
    }

    if (
      document.getElementById("settingsRecordAudio").checked &&
      !navigator.mediaDevices
    ) {
      this.showToast("Media devices not available", "error");
      return;
    }

    const countdownSeconds = this.settings.countdown || 0;

    if (countdownSeconds > 0) {
      const cancelled = await this.runCountdown(countdownSeconds);
      if (cancelled) return;
    }

    try {
      this.recordedChunks = [];
      this.startBtn.disabled = true;
      this.selectSourceBtn.disabled = true;
      this.pauseBtn.disabled = true;
      this.stopBtn.disabled = true;
      this.startBtn.textContent = "Starting...";

      if (document.getElementById("settingsRecordAudio").checked) {
        try {
          const micDeviceId =
            this.settings.selectedMicrophone !== "default"
              ? this.settings.selectedMicrophone
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
          this.showToast(
            "Audio device unavailable, recording video only",
            "info",
          );
        }
      }

      const videoTracks = this.videoStream.getTracks();
      const audioTracks = this.audioStream ? this.audioStream.getTracks() : [];

      if (videoTracks.length === 0) {
        throw new Error("No video tracks available");
      }

      this.mixedStream = new MediaStream([...videoTracks, ...audioTracks]);

      const mimeType = this.getSupportedMimeType();

      if (!mimeType) {
        throw new Error("No supported video format available");
      }

      this.mediaRecorder = new MediaRecorder(this.mixedStream, {
        mimeType,
        videoBitsPerSecond: this.getVideoBitrate(),
      });

      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          this.recordedChunks.push(e.data);
        }
      };

      this.mediaRecorder.onstop = () => this.handleRecordingComplete();

      this.mediaRecorder.start(100);
      this.isRecording = true;
      this.recordingStartTime = Date.now();

      await window.electronAPI.setRecordingState(true);

      this.updateUIForRecording();
      this.startRecordingTimer();

      if (this.settings.hideWindowDuringRecording) {
        await window.electronAPI.windowMinimize();
      }

      this.showToast("Recording started", "info");
    } catch (err) {
      this.showToast(`Failed to start: ${err.message}`, "error");
      console.error(err);
    }
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
    switch (this.settings.videoQuality) {
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
      this.recordingTime.textContent = this.formatTime(elapsed);
    }, 1000);
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

  async stopRecording() {
    if (!this.isRecording || !this.mediaRecorder) return;

    try {
      this.mediaRecorder.stop();
      this.isRecording = false;

      if (this.recordingTimer) {
        clearInterval(this.recordingTimer);
        this.recordingTimer = null;
      }

      this.updateUIForStopped();
      await window.electronAPI.setRecordingState(false);

      this.processingOverlay.classList.add("active");
      this.processingText.textContent = "Saving recording...";
      this.progressFill.style.width = "0%";
      this.progressPercent.textContent = "0%";
    } catch (err) {
      this.showToast(`Failed to stop: ${err.message}`, "error");
      console.error(err);
    }
  }

  togglePause() {
    if (!this.isRecording || !this.mediaRecorder) return;

    if (this.isPaused) {
      this.resumeRecording();
    } else {
      this.pauseRecording();
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

      this.updateUIPaused();
      this.showToast("Recording paused", "info");

      window.electronAPI.setRecordingState(true, true);
    } catch (err) {
      console.error("Failed to pause:", err);
      this.showToast(`Failed to pause: ${err.message}`, "error");
    }
  }

  resumeRecording() {
    if (!this.mediaRecorder || !this.isPaused) return;

    try {
      this.mediaRecorder.resume();
      this.isPaused = false;

      this.recordingStartTime = Date.now();
      this.startRecordingTimer();

      this.updateUIForRecording();
      this.showToast("Recording resumed", "info");

      window.electronAPI.setRecordingState(true, false);
    } catch (err) {
      console.error("Failed to resume:", err);
      this.showToast(`Failed to resume: ${err.message}`, "error");
    }
  }

  updateUIPaused() {
    this.pauseBtn.disabled = false;
    this.pauseIcon.style.display = "none";
    this.resumeIcon.style.display = "block";
    this.pauseBtnText.textContent = "Resume";
    this.stopBtn.disabled = false;
    this.recordingIndicator.classList.add("hidden");
  }

  async handleRecordingComplete() {
    try {
      const settings = await window.electronAPI.getSettings();
      const blob = new Blob(this.recordedChunks, {
        type: this.getSupportedMimeType(),
      });
      const arrayBuffer = await blob.arrayBuffer();

      const result = await window.electronAPI.saveRecording(arrayBuffer);

      if (result.canceled) {
        this.processingOverlay.classList.remove("active");
        this.showToast("Recording cancelled", "info");
        return;
      }

      if (!result.success) {
        this.processingOverlay.classList.remove("active");
        this.showToast(result.error || "Failed to save recording", "error");
        return;
      }

      if (settings.defaultFormat === "webm" || !settings.defaultFormat) {
        this.processingOverlay.classList.remove("active");
        this.showToast("Recording saved!", "success");
        if (settings.autoOpenAfterRecording) {
          window.electronAPI.openFile(result.filePath);
        }
        this.showCompletionOptions(result.filePath);
      }
    } catch (err) {
      this.processingOverlay.classList.remove("active");
      this.showToast(`Error: ${err.message}`, "error");
      console.error(err);
    }

    if (this.mixedStream) {
      this.mixedStream.getTracks().forEach((track) => track.stop());
      this.mixedStream = null;
    }
  }

  showCompletionOptions(filePath) {
    const toast = document.createElement("div");
    toast.className = "toast success";
    toast.innerHTML = `
      <span>Recording saved!</span>
      <button class="toast-btn" id="openLocation">Open Location</button>
      <button class="toast-btn" id="playVideo">Play</button>
      <button class="toast-btn" id="closeToast">Close</button>
    `;

    this.toastContainer.appendChild(toast);

    document.getElementById("openLocation")?.addEventListener("click", () => {
      window.electronAPI.openFileLocation(filePath);
    });

    document.getElementById("playVideo")?.addEventListener("click", () => {
      window.electronAPI.openFile(filePath);
    });

    document.getElementById("closeToast")?.addEventListener("click", () => {
      toast.remove();
    });

    setTimeout(() => toast.remove(), 15000);
  }

  updateUIForRecording() {
    this.startBtn.disabled = true;
    this.pauseBtn.disabled = false;
    this.pauseIcon.style.display = "block";
    this.resumeIcon.style.display = "none";
    this.pauseBtnText.textContent = "Pause";
    this.stopBtn.disabled = false;
    this.selectSourceBtn.disabled = true;
    this.stopBtn.classList.add("recording");
    this.recordingIndicator.classList.remove("hidden");
    this.recordingTime.textContent = "00:00:00";

    this.hotkeyKey.textContent = this.settings.shortcutKey || "F9";
    this.hotkeyOverlay.classList.remove("hidden");
  }

  updateUIForStopped() {
    this.startBtn.disabled = false;
    this.startBtn.textContent = "Start Recording";
    this.pauseBtn.disabled = true;
    this.pauseIcon.style.display = "block";
    this.resumeIcon.style.display = "none";
    this.pauseBtnText.textContent = "Pause";
    this.stopBtn.disabled = true;
    this.selectSourceBtn.disabled = false;
    this.stopBtn.classList.remove("recording");
    this.recordingIndicator.classList.add("hidden");
    this.hotkeyOverlay.classList.add("hidden");
    this.isPaused = false;
  }

  openSettingsModal() {
    document.getElementById("settingsQuality").value =
      this.settings.videoQuality || "high";
    document.getElementById("settingsFrameRate").value =
      this.settings.frameRate || 30;
    document.getElementById("settingsResolution").value =
      this.settings.resolution || "1920x1080";
    document.getElementById("settingsOutputDir").value =
      this.settings.outputDirectory || "";
    document.getElementById("settingsRecordAudio").checked =
      this.settings.recordAudio !== false;
    document.getElementById("settingsCountdown").value =
      this.settings.countdown || 5;
    document.getElementById("settingsFilenamePattern").value =
      this.settings.filenamePattern || "Recording_{date}_{time}";
    document.getElementById("settingsCompression").value =
      this.settings.compression || "balanced";
    document.getElementById("settingsHardwareAcceleration").value =
      this.settings.hardwareAcceleration || "none";
    document.getElementById("settingsAutoSave").checked =
      this.settings.autoSave || false;
    document.getElementById("settingsAutoOpen").checked =
      this.settings.autoOpenAfterRecording !== false;
    document.getElementById("settingsHideWindow").checked =
      this.settings.hideWindowDuringRecording || false;
    document.getElementById("settingsShortcut").checked =
      this.settings.shortcutEnabled !== false;
    document.getElementById("settingsShortcutKey").value =
      this.settings.shortcutKey || "F9";
    document.getElementById("settingsShowNotifications").checked =
      this.settings.showNotifications !== false;

    this.loadAudioDevicesForSettings();
    this.updateHardwareAccelerationOptions();

    this.settingsModal.classList.add("active");
  }

  async updateHardwareAccelerationOptions() {
    const hwSelect = document.getElementById("settingsHardwareAcceleration");
    const resp = await window.electronAPI.getAvailableEncoders();
    const encoders = resp && resp.encoders ? resp.encoders : resp;
    const systemPath = resp && resp.systemFfmpeg ? resp.systemFfmpeg : null;

    this.availableEncoders = encoders || {
      nvenc: false,
      qsv: false,
      amf: false,
    };
    this.systemFfmpeg = systemPath || null;

    hwSelect.options[1].text = this.availableEncoders.nvenc
      ? "NVIDIA NVENC (Available)"
      : "NVIDIA NVENC (Not Available)";
    hwSelect.options[2].text = this.availableEncoders.qsv
      ? "Intel QSV (Available)"
      : "Intel QSV (Not Available)";
    hwSelect.options[3].text = this.availableEncoders.amf
      ? "AMD AMF (Available)"
      : "AMD AMF (Not Available)";

    if (this.hwInfo) {
      this.hwInfo.textContent = this.systemFfmpeg
        ? `System FFmpeg: ${this.systemFfmpeg}`
        : "System FFmpeg: Not found";
    }

    if (this.hwAutoBtn) {
      this.hwAutoBtn.style.display =
        this.availableEncoders && this.availableEncoders.nvenc
          ? "inline-block"
          : "none";
    }

    // Show non-destructive NVENC suggestion if available and user hasn't opted in or dismissed
    try {
      const shouldShow =
        this.availableEncoders &&
        this.availableEncoders.nvenc &&
        this.settings &&
        (this.settings.hardwareAcceleration === "none" ||
          !this.settings.hardwareAcceleration) &&
        !this.settings.nvencPromptDismissed;

      if (shouldShow && this.nvencPrompt) {
        this.nvencPrompt.style.display = "block";
      } else if (this.nvencPrompt) {
        this.nvencPrompt.style.display = "none";
      }
    } catch (e) {
      // ignore
    }
  }

  async loadAudioDevicesForSettings() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioDevices = devices.filter((d) => d.kind === "audioinput");

      const micSelect = document.getElementById("settingsMicrophone");
      micSelect.innerHTML =
        '<option value="default">Default Microphone</option>';

      audioDevices.forEach((device) => {
        const option = document.createElement("option");
        option.value = device.deviceId;
        option.textContent =
          device.label || `Microphone ${device.deviceId.slice(0, 8)}`;
        micSelect.appendChild(option);
      });

      if (this.settings.selectedMicrophone) {
        micSelect.value = this.settings.selectedMicrophone;
      }
    } catch (err) {
      console.error("Failed to load audio devices:", err);
    }
  }

  async saveSettings() {
    const newSettings = {
      videoQuality: document.getElementById("settingsQuality").value,
      frameRate: parseInt(document.getElementById("settingsFrameRate").value),
      resolution: document.getElementById("settingsResolution").value,
      outputDirectory: document.getElementById("settingsOutputDir").value,
      recordAudio: document.getElementById("settingsRecordAudio").checked,
      selectedMicrophone: document.getElementById("settingsMicrophone").value,
      hideWindowDuringRecording:
        document.getElementById("settingsHideWindow").checked,
      shortcutEnabled: document.getElementById("settingsShortcut").checked,
      shortcutKey: document.getElementById("settingsShortcutKey").value,
      showNotifications: document.getElementById("settingsShowNotifications")
        .checked,
      countdown: parseInt(document.getElementById("settingsCountdown").value),
      filenamePattern: document.getElementById("settingsFilenamePattern").value,
      compression: document.getElementById("settingsCompression").value,
      hardwareAcceleration: document.getElementById(
        "settingsHardwareAcceleration",
      ).value,
      autoSave: document.getElementById("settingsAutoSave").checked,
      autoOpenAfterRecording:
        document.getElementById("settingsAutoOpen").checked,
    };

    console.log("Saving newSettings:", JSON.stringify(newSettings));

    try {
      this.settings = await window.electronAPI.saveSettings(newSettings);
      this.applySettings();
      this.closeModal(this.settingsModal);
      this.showToast("Settings saved", "success");
    } catch (err) {
      this.showToast("Failed to save settings", "error");
      console.error(err);
    }
  }

  closeModal(modal) {
    modal.classList.remove("active");
  }

  async toggleMaximize() {
    const isMaximized = await window.electronAPI.windowMaximize();
    if (isMaximized) {
      this.maximizeBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 12 12">
        <rect x="2.5" y="0.5" width="8" height="8" fill="none" stroke="currentColor" stroke-width="1"/>
        <rect x="0.5" y="2.5" width="8" height="8" fill="var(--bg-card)" stroke="currentColor" stroke-width="1"/>
      </svg>`;
    } else {
      this.maximizeBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 12 12">
        <rect x="1.5" y="1.5" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1"/>
      </svg>`;
    }
  }

  showToast(message, type = "info") {
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.textContent = message;

    this.toastContainer.appendChild(toast);

    setTimeout(() => toast.remove(), 4000);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  new ScreenRecorder();
});
