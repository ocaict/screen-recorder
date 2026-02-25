class ScreenRecorder {
  constructor() {
    this.settings = {};
    this.recordingManager = null;
    this.sourceManager = null;
    this.uiManager = null;
    this.annotationManager = null;

    this.initialize();
  }

  async initialize() {
    this.uiManager = new UIManager(this);
    this.uiManager.initializeElements();

    // Create performance monitor for tracking metrics
    let monitor = null;
    if (window.PerformanceMonitor) {
      monitor = new window.PerformanceMonitor();
    }

    this.recordingManager = new RecordingManager(this, monitor);
    this.sourceManager = new SourceManager(this);
    this.annotationManager = new AnnotationManager(this);
    this.annotationManager.init();

    await this.recordingManager.init();

    this.initializeEventListeners();
    this.initializeIPCListeners();
    this.loadSettings();
    this.loadAudioDevices();
  }

  initializeEventListeners() {
    this.selectSourceBtn.addEventListener("click", () =>
      this.sourceManager.openSourceModal(),
    );

    this.selectRegionBtn = document.getElementById("selectRegionBtn");
    this.selectRegionBtn?.addEventListener("click", async () => {
      try {
        const region = await window.electronAPI.startRegionSelection();
        if (region) {
          this.recordingManager.selectedRegion = region;

          try {
            const sources = await window.electronAPI.getCaptureSources();
            const screenSource = sources.find((s) =>
              s.id.startsWith("screen:"),
            );

            if (screenSource) {
              const fullStream = await navigator.mediaDevices.getUserMedia({
                video: {
                  mandatory: {
                    chromeMediaSource: "desktop",
                    chromeMediaSourceId: screenSource.id,
                    minWidth: 1920,
                    maxWidth: 1920,
                    minHeight: 1080,
                    maxHeight: 1080,
                  },
                },
                audio: false,
              });

              const cropCanvas = document.createElement("canvas");
              cropCanvas.width = region.width;
              cropCanvas.height = region.height;
              const ctx = cropCanvas.getContext("2d");

              const fullVideo = document.createElement("video");
              fullVideo.srcObject = fullStream;
              fullVideo.muted = true;
              fullVideo.playsInline = true;
              await fullVideo.play();

              const drawCrop = () => {
                if (fullVideo.readyState >= 2) {
                  ctx.drawImage(
                    fullVideo,
                    region.x,
                    region.y,
                    region.width,
                    region.height,
                    0,
                    0,
                    region.width,
                    region.height,
                  );
                }
                this.cropDrawId = requestAnimationFrame(drawCrop);
              };
              this.cropDrawId = requestAnimationFrame(drawCrop);

              const croppedStream = cropCanvas.captureStream(30);
              this.previewVideo.srcObject = croppedStream;
              this.previewVideo.style.objectFit = "contain";
              this.previewVideo.style.width = "100%";
              this.previewVideo.style.height = "100%";
              await this.previewVideo.play();
              this.noSourceMessage.classList.add("hidden");

              this.currentPreviewStream = fullStream;
              this.currentCropCanvas = cropCanvas;
            }
          } catch (previewErr) {
            console.warn("Preview capture failed:", previewErr);
          }

          this.showToast(
            `Region selected: ${region.width}x${region.height}`,
            "success",
          );
          this.startBtn.disabled = false;
          this.sourceList.innerHTML = `
            <div class="source-item active">
              <div class="source-thumbnail region-thumb">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>
                </svg>
              </div>
              <span class="source-name">Region: ${region.width}x${region.height}</span>
            </div>
          `;
          document
            .querySelectorAll(".timer-preset")
            .forEach((btn) => (btn.disabled = false));
        }
      } catch (err) {
        console.error("Region selection error:", err);
        this.showToast("Failed to select region", "error");
      }
    });

    if (this.processingCancel) {
      this.processingCancel.addEventListener("click", async () => {
        if (confirm("Cancel processing? The recording will be lost.")) {
          this.isProcessingCancelled = true;
          this.processingOverlay.classList.remove("active");
          this.processingStatus.textContent = "Cancelling...";
          if (window.electronAPI && window.electronAPI.cancelConversion) {
            try {
              await window.electronAPI.cancelConversion();
            } catch (err) {
              console.error("Failed to cancel conversion:", err);
              this.showToast("Failed to cancel conversion", "error");
            }
          }
          this.showToast("Processing cancelled", "info");
        }
      });
    }

    if (this.emptySourceBtn) {
      this.emptySourceBtn.addEventListener("click", () =>
        this.sourceManager.openSourceModal(),
      );
    }

    document.querySelectorAll(".timer-preset").forEach((btn) => {
      btn.addEventListener("click", () => {
        document
          .querySelectorAll(".timer-preset")
          .forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        this.timerPreset = parseInt(btn.dataset.minutes) || 0;
      });
    });

    this.startBtn.addEventListener("click", () =>
      this.recordingManager.startRecording(),
    );
    this.pauseBtn.addEventListener("click", () => this.togglePause());
    this.stopBtn.addEventListener("click", () =>
      this.recordingManager.stopRecording(),
    );
    this.annotationToggleBtn.addEventListener("click", () =>
      this.toggleAnnotation(),
    );
    this.closeSourceModal.addEventListener("click", () =>
      this.closeModal(this.sourceModal),
    );
    this.closeSettingsModal.addEventListener("click", () =>
      this.closeModal(this.settingsModal),
    );
    this.settingsBtn.addEventListener("click", () => this.openSettingsModal());

    // Store document keydown handler for cleanup
    this.keydownHandler = (e) => {
      if (e.key === "Escape") {
        if (this.sourceModal.classList.contains("active")) {
          this.closeModal(this.sourceModal);
        } else if (this.settingsModal.classList.contains("active")) {
          this.closeModal(this.settingsModal);
        }
      }
      if (e.key === "Tab") {
        if (this.sourceModal.classList.contains("active")) {
          this.uiManager.trapFocus(e, this.sourceModal);
        } else if (this.settingsModal.classList.contains("active")) {
          this.uiManager.trapFocus(e, this.settingsModal);
        }
      }
      if (e.ctrlKey && e.key === ",") {
        e.preventDefault();
        this.openSettingsModal();
      }
      if (e.key === "F2" && this.recordingManager?.isRecording) {
        e.preventDefault();
        this.toggleAnnotation();
      }
    };
    document.addEventListener("keydown", this.keydownHandler);
    this.saveSettingsBtn.addEventListener("click", () => this.saveSettings());

    document
      .getElementById("browseOutputDir")
      ?.addEventListener("click", async () => {
        try {
          const dir = await window.electronAPI.selectDirectory();
          if (dir) {
            document.getElementById("settingsOutputDir").value = dir;
          }
        } catch (err) {
          console.error("Failed to select directory:", err);
          this.showToast("Failed to select directory", "error");
        }
      });

    document
      .getElementById("settingsShortcut")
      ?.addEventListener("change", (e) => {
        const shortcutKey = document.getElementById("settingsShortcutKey");
        if (shortcutKey) {
          shortcutKey.disabled = !e.target.checked;
        }
      });

    document
      .getElementById("resetSettingsBtn")
      ?.addEventListener("click", async () => {
        if (!confirm("Reset all settings to defaults?")) return;
        document.getElementById("settingsQuality").value = "high";
        document.getElementById("settingsFrameRate").value = "24";
        document.getElementById("settingsResolution").value = "1920x1080";
        document.getElementById("settingsRecordAudio").checked = true;
        document.getElementById("settingsMicrophone").value = "default";
        document.getElementById("settingsCountdown").value = "3";
        document.getElementById("settingsOutputDir").value = "";
        document.getElementById("settingsFilenamePattern").value =
          "Recording_{date}_{time}";
        document.getElementById("settingsCompression").value = "balanced";
        document.getElementById("settingsHardwareAcceleration").value = "none";
        document.getElementById("settingsFormat").value = "mp4";
        document.getElementById("settingsAutoSave").checked = true;
        document.getElementById("settingsAutoOpen").checked = true;
        document.getElementById("settingsHideWindow").checked = true;
        document.getElementById("settingsShortcut").checked = true;
        document.getElementById("settingsShortcutKey").value = "F9";
        document.getElementById("settingsShortcutKey").disabled = false;
        document.getElementById("settingsShowNotifications").checked = true;
        this.updateFileSizeEstimate();

        try {
          await this.saveSettings(true);
          this.showToast("Settings reset to defaults", "success");
        } catch (err) {
          this.showToast("Failed to reset settings", "error");
        }
      });

    document
      .getElementById("settingsQuality")
      ?.addEventListener("change", () => this.updateFileSizeEstimate());
    document
      .getElementById("settingsResolution")
      ?.addEventListener("change", () => this.updateFileSizeEstimate());
    document
      .getElementById("settingsFrameRate")
      ?.addEventListener("change", () => this.updateFileSizeEstimate());
    document
      .getElementById("settingsRecordAudio")
      ?.addEventListener("change", () => this.updateFileSizeEstimate());

    document
      .getElementById("settingsWebcam")
      ?.addEventListener("change", (e) => {
        const webcamGroups = document.querySelectorAll(
          '[id$="Group"][id*="webcam"]',
        );
        webcamGroups.forEach((el) => {
          el.style.display = e.target.checked ? "block" : "none";
        });
      });

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
          if (this.nvencPrompt) this.nvencPrompt.classList.remove("show");
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
          if (this.nvencPrompt) {
            this.nvencPrompt.classList.remove("show");
            this.nvencPrompt.style.display = "none";
          }
        } catch (err) {
          this.showToast("Failed to dismiss prompt", "error");
        }
      });
    }
    this.minimizeBtn.addEventListener("click", () =>
      window.electronAPI
        .windowMinimize()
        .catch((err) => console.error("Failed to minimize window:", err)),
    );
    this.maximizeBtn.addEventListener("click", () => this.toggleMaximize());
    this.closeBtn.addEventListener("click", () =>
      window.electronAPI
        .windowClose()
        .catch((err) => console.error("Failed to close window:", err)),
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

    if (this.showShortcutsBtn) {
      this.showShortcutsBtn.addEventListener("click", () =>
        this.openShortcutsModal(),
      );
    }
    if (this.closeShortcutsModal) {
      this.closeShortcutsModal.addEventListener("click", () =>
        this.closeModal(this.shortcutsModal),
      );
    }
    if (this.shortcutsModal) {
      this.shortcutsModal.addEventListener("click", (e) => {
        if (e.target === this.shortcutsModal)
          this.closeModal(this.shortcutsModal);
      });
    }

    if (this.settingsTimerPreset) {
      this.settingsTimerPreset.addEventListener("change", () => {
        if (this.settingsTimerPreset.value === "custom") {
          this.customTimerGroup.style.display = "block";
        } else {
          this.customTimerGroup.style.display = "none";
        }
      });
    }

    if (this.settingsScheduledRecording) {
      this.settingsScheduledRecording.addEventListener("change", () => {
        this.scheduleTimeGroup.style.display = this.settingsScheduledRecording
          .checked
          ? "block"
          : "none";
      });
    }
  }

  switchTab(tabName) {
    document.querySelectorAll(".settings-tab").forEach((t) => {
      t.classList.remove("active");
      t.setAttribute("aria-selected", "false");
    });
    document
      .querySelectorAll(".tab-content")
      .forEach((c) => c.classList.remove("active"));
    document
      .querySelector(`.settings-tab[data-tab="${tabName}"]`)
      .classList.add("active");
    document
      .querySelector(`.settings-tab[data-tab="${tabName}"]`)
      .setAttribute("aria-selected", "true");
    document.getElementById(`tab-${tabName}`).classList.add("active");
  }

  initializeIPCListeners() {
    window.electronAPI.onStopRecordingFromTray(() => {
      if (this.recordingManager.isRecording)
        this.recordingManager.stopRecording();
    });

    window.electronAPI.onStopRecordingFromShortcut(() => {
      if (
        this.recordingManager.mediaRecorder &&
        (this.recordingManager.mediaRecorder.state === "recording" ||
          this.recordingManager.mediaRecorder.state === "paused")
      ) {
        this.recordingManager.stopRecording();
      } else if (
        this.recordingManager.isRecording ||
        this.recordingManager.mediaRecorder
      ) {
        this.recordingManager.stopRecording();
      }
    });

    window.electronAPI.onResumeRecordingFromTray(() => {
      if (this.recordingManager.isRecording && this.recordingManager.isPaused)
        this.recordingManager.resumeRecording();
    });

    window.electronAPI.onPauseRecordingFromTray(() => {
      if (this.recordingManager.isRecording && !this.recordingManager.isPaused)
        this.recordingManager.pauseRecording();
    });

    window.electronAPI.onStopRecordingFromQuit(async () => {
      if (this.recordingManager.isRecording) {
        await this.recordingManager.stopRecording();
        await new Promise((resolve) => setTimeout(resolve, 1000));
        try {
          await window.electronAPI.windowClose();
        } catch (err) {
          console.error(
            "Failed to close window after stopping recording:",
            err,
          );
        }
      }
    });

    window.electronAPI.onConversionStarted(() => {
      this.processingOverlay.classList.add("active");
      this.processingTitle.textContent = "Processing Video";
      this.processingStatus.textContent = "Converting video...";
      this.processingStartTime = Date.now();
      this.progressFill.style.width = "0%";
      this.progressPercent.textContent = "0%";
      this.progressEta.textContent = "Starting...";
      this.showToast("Video conversion started in background", "info");
    });

    window.electronAPI.onConversionProgress((progress) => {
      if (progress && progress.warning) {
        this.showToast(progress.warning, "warning");
        this.processingStatus.textContent = "Converting (software fallback)";
        return;
      }

      const percent = progress.percent || 0;
      this.progressFill.style.width = `${percent}%`;
      this.progressPercent.textContent = `${Math.round(percent)}%`;

      if (progress.stage) {
        const stageMessages = {
          converting: "Converting video...",
          muxing: "Muxing audio...",
          encoding: "Encoding...",
          saving: "Saving file...",
          finalizing: "Finalizing...",
        };
        this.processingStatus.textContent =
          stageMessages[progress.stage] || "Processing...";
      }

      if (this.processingStartTime && percent > 0) {
        const elapsed = (Date.now() - this.processingStartTime) / 1000;
        const estimatedTotal = elapsed / (percent / 100);
        const remaining = estimatedTotal - elapsed;
        if (remaining > 0) {
          const mins = Math.floor(remaining / 60);
          const secs = Math.floor(remaining % 60);
          this.progressEta.textContent =
            mins > 0 ? `${mins}m ${secs}s remaining` : `${secs}s remaining`;
        }
      }
    });

    window.electronAPI.onConversionComplete(async (filePath) => {
      try {
        this.processingOverlay.classList.remove("active");

        const fileName = filePath.split(/[\\\/]/).pop();
        const isMp4 = filePath.toLowerCase().endsWith(".mp4");

        if (isMp4) {
          this.showToast(`Conversion complete: ${fileName}`, "success");
        } else {
          this.showToast(`Recording saved: ${fileName}`, "success");
        }

        try {
          const settings = await window.electronAPI.getSettings();
          if (settings && settings.autoOpenAfterRecording) {
            try {
              await window.electronAPI.openFile(filePath);
            } catch (openErr) {
              console.warn("Failed to open file after conversion:", openErr);
            }
          }
        } catch (settingsErr) {
          console.warn(
            "Could not retrieve settings after conversion:",
            settingsErr,
          );
        }

        await this.loadRecentRecordings();
        this.showCompletionOptions(filePath);
      } catch (err) {
        console.error("Error handling conversion complete:", err);
        this.showToast("An error occurred after conversion", "error");
      }
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
      this.updateQuickSettings();
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
        '<div class="no-recordings" role="status"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><polygon points="5,3 19,12 5,21" /></svg><p class="no-recordings-text">No recordings yet</p><p class="no-recordings-hint">Your recorded videos will appear here</p></div>';
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
        <div class="recent-recording-item" role="listitem" data-path="${recording.filePath}" title="${recording.filePath}" tabindex="0" aria-label="${recording.fileName}, ${dateStr}, ${sizeStr}">
          <div class="recent-recording-thumb">
            <svg class="recent-recording-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <polygon points="5,3 19,12 5,21"/>
            </svg>
          </div>
          <div class="recent-recording-info">
            <div class="recent-recording-name">${recording.fileName}</div>
            <div class="recent-recording-meta">
              <span class="recent-recording-date">${dateStr}</span>
              <span class="recent-recording-divider">•</span>
              <span class="recent-recording-size">${sizeStr}</span>
            </div>
          </div>
          <div class="recent-recording-actions">
            <button class="btn-action btn-play" data-path="${recording.filePath}" title="Play" aria-label="Play ${recording.fileName}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="5,3 19,12 5,21"/>
              </svg>
            </button>
            <button class="btn-action btn-folder" data-path="${recording.filePath}" title="Open folder" aria-label="Open folder containing ${recording.fileName}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
              </svg>
            </button>
            <button class="btn-action btn-delete" data-path="${recording.filePath}" title="Delete" aria-label="Delete ${recording.fileName}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
              </svg>
            </button>
          </div>
        </div>
      `;
      })
      .join("");

    this.recentRecordingsList
      .querySelectorAll(".recent-recording-item")
      .forEach((item) => {
        const openRecording = async (e) => {
          if (e.target.closest(".btn-action")) return;
          const filePath = item.dataset.path;
          try {
            await window.electronAPI.openFile(filePath);
          } catch (err) {
            console.error("Failed to open recording:", err);
            this.showToast("Failed to open recording", "error");
          }
        };
        item.addEventListener("click", openRecording);
        item.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openRecording(e);
          }
        });
      });

    this.recentRecordingsList.querySelectorAll(".btn-play").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const filePath = btn.dataset.path;
        try {
          await window.electronAPI.openFile(filePath);
        } catch (err) {
          console.error("Failed to open file:", err);
          this.showToast("Failed to open file", "error");
        }
      });
    });

    this.recentRecordingsList.querySelectorAll(".btn-folder").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const filePath = btn.dataset.path;
        try {
          await window.electronAPI.openFileLocation(filePath);
        } catch (err) {
          console.error("Failed to open file location:", err);
          this.showToast("Failed to open file location", "error");
        }
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
    return this.uiManager.formatFileSize(bytes);
  }

  updateFileSizeEstimate() {
    const quality = document.getElementById("settingsQuality")?.value || "high";
    const resolution =
      document.getElementById("settingsResolution")?.value || "1920x1080";
    const frameRate = parseInt(
      document.getElementById("settingsFrameRate")?.value || "30",
    );
    const recordAudio =
      document.getElementById("settingsRecordAudio")?.checked !== false;

    const [width, height] = resolution.split("x").map(Number);
    const pixels = width * height;
    const pixelsPerSecond = pixels * frameRate;

    let bitrateMultiplier;
    switch (quality) {
      case "low":
        bitrateMultiplier = 0.1;
        break;
      case "medium":
        bitrateMultiplier = 0.25;
        break;
      case "high":
        bitrateMultiplier = 0.5;
        break;
      case "ultra":
        bitrateMultiplier = 1.0;
        break;
      default:
        bitrateMultiplier = 0.5;
    }

    let videoBitrate = (pixelsPerSecond * bitrateMultiplier) / 8;
    let audioBitrate = recordAudio ? (128 * 1024) / 8 : 0;

    const totalBitratePerSecond = videoBitrate + audioBitrate;
    const durationSeconds = 60;
    const estimatedBytes = totalBitratePerSecond * durationSeconds;

    const sizeValue = this.fileSizePreview?.querySelector(".size-value");
    if (sizeValue) {
      sizeValue.textContent = `~${this.formatFileSize(estimatedBytes)}`;
    }
  }

  updateQuickSettings() {
    const resolution = this.settings.resolution || "1920x1080";
    const frameRate = this.settings.frameRate || 24;
    const quality = this.settings.videoQuality || "high";

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

    const qualityLabel = quality.charAt(0).toUpperCase() + quality.slice(1);

    if (this.quickResolution) this.quickResolution.textContent = resLabel;
    if (this.quickFps) this.quickFps.textContent = `${frameRate} fps`;
    if (this.quickQuality) this.quickQuality.textContent = qualityLabel;
  }

  showQuickSettings() {
    if (this.quickSettings) {
      this.quickSettings.classList.add("show");
    }
  }

  hideQuickSettings() {
    if (this.quickSettings) {
      this.quickSettings.classList.remove("show");
    }
  }

  applySettings() {
    document.getElementById("settingsQuality").value =
      this.settings.videoQuality || "high";
    document.getElementById("settingsFrameRate").value =
      this.settings.frameRate || "24";
    document.getElementById("settingsResolution").value =
      this.settings.resolution || "1920x1080";
    document.getElementById("settingsRecordAudio").checked =
      this.settings.recordAudio !== false;
    document.getElementById("settingsCountdown").value =
      this.settings.countdown || "3";
    document.getElementById("settingsOutputDir").value =
      this.settings.outputDirectory || "";
    document.getElementById("settingsFilenamePattern").value =
      this.settings.filenamePattern || "Recording_{date}_{time}";
    document.getElementById("settingsAutoSave").checked =
      this.settings.autoSave !== false;
    document.getElementById("settingsAutoOpen").checked =
      this.settings.autoOpenAfterRecording !== false;
    document.getElementById("settingsHideWindow").checked =
      this.settings.hideWindowDuringRecording !== false;
    document.getElementById("settingsShortcut").checked =
      this.settings.shortcutEnabled !== false;
    document.getElementById("settingsShortcutKey").value =
      this.settings.shortcutKey || "F9";
    document.getElementById("settingsShortcutKey").disabled =
      this.settings.shortcutEnabled === false;
    document.getElementById("settingsFormat").value =
      this.settings.defaultFormat || "mp4";

    if (document.getElementById("settingsWebcam")) {
      document.getElementById("settingsWebcam").checked =
        this.settings.webcamEnabled || false;
      if (document.getElementById("settingsCamera")) {
        document.getElementById("settingsCamera").value =
          this.settings.selectedCamera || "default";
      }
      document.getElementById("settingsWebcamPosition").value =
        this.settings.webcamPosition || "bottom-right";
      document.getElementById("settingsWebcamSize").value =
        this.settings.webcamSize || "medium";

      const webcamGroups = document.querySelectorAll(
        '[id$="Group"][id*="webcam"]',
      );
      webcamGroups.forEach((el) => {
        el.style.display =
          this.settings.webcamEnabled || false ? "block" : "none";
      });
    }
  }

  async loadAudioDevices() {}

  togglePause() {
    if (
      !this.recordingManager.isRecording ||
      !this.recordingManager.mediaRecorder
    )
      return;

    if (this.recordingManager.isPaused) {
      this.recordingManager.resumeRecording();
    } else {
      this.recordingManager.pauseRecording();
    }
  }

  toggleAnnotation() {
    if (!this.annotationManager) return;

    if (this.annotationManager.isActive) {
      this.annotationManager.deactivate();
      this.annotationToggleBtn.classList.remove("active");
      this.annotationToggleBtn.querySelector("span").textContent = "Annotate";
    } else {
      this.annotationManager.activate();
      this.annotationToggleBtn.classList.add("active");
      this.annotationToggleBtn.querySelector("span").textContent = "Drawing";
    }
  }

  updateUIPaused() {
    this.pauseBtn.disabled = false;
    this.pauseBtn.setAttribute("aria-label", "Resume recording");
    this.pauseIcon.style.display = "none";
    this.resumeIcon.style.display = "block";
    this.pauseBtnText.textContent = "Resume";
    this.stopBtn.disabled = false;
    this.recordingIndicator.classList.add("hidden");
    this.recordingPill?.classList.add("hidden");
  }

  updateUIForRecording() {
    this.startBtn.disabled = true;
    this.pauseBtn.disabled = false;
    this.pauseBtn.setAttribute("aria-label", "Pause recording");
    this.pauseIcon.style.display = "block";
    this.resumeIcon.style.display = "none";
    this.pauseBtnText.textContent = "Pause";
    this.stopBtn.disabled = false;
    this.annotationToggleBtn.disabled = false;
    this.selectSourceBtn.disabled = true;
    this.stopBtn.classList.add("recording");
    this.recordingIndicator.classList.remove("hidden");
    this.recordingPill?.classList.remove("hidden");
    this.recordingTime.textContent = "00:00:00";
    if (this.pillTime) this.pillTime.textContent = "00:00";

    this.recordingStats?.classList.remove("hidden");
    this.recordingManager.recordedBytes = 0;
    this.recordingManager.updateRecordingStats();
    this.hideQuickSettings();

    this.hotkeyKey.textContent = this.settings.shortcutKey || "F9";
    this.hotkeyOverlay.classList.remove("hidden");
  }

  updateUIForStopped() {
    this.recordingManager.stopCurrentStream();
    this.recordingManager.selectedRegion = null;

    if (this.cropDrawId) {
      cancelAnimationFrame(this.cropDrawId);
      this.cropDrawId = null;
    }
    if (this.currentPreviewStream) {
      this.currentPreviewStream.getTracks().forEach((t) => t.stop());
      this.currentPreviewStream = null;
    }
    this.currentCropCanvas = null;

    this.previewVideo.srcObject = null;
    this.previewVideo.poster = "";
    this.previewVideo.load();

    this.noSourceMessage.classList.remove("hidden");
    this.noSourceMessage.innerHTML = `
      <div class="empty-state-icon">
        <svg width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" stroke-linecap="round" stroke-linejoin="round"/>
          <polyline points="22 4 12 14.01 9 11.01" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
      <p class="empty-state-title">Recording Complete!</p>
      <p class="empty-state-desc">Select a source to record again</p>
      <button class="empty-state-btn" id="emptySourceBtn" aria-label="Select a screen source">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
          <circle cx="8" cy="10" r="2" />
          <line x1="8" y1="21" x2="16" y2="21" />
          <line x1="12" y1="17" x2="12" y2="21" />
        </svg>
        Select Source
      </button>
    `;

    this.startBtn.disabled = false;
    this.startBtn.textContent = "Start Recording";
    this.pauseBtn.disabled = true;
    this.pauseBtn.setAttribute("aria-label", "Pause recording");
    this.pauseIcon.style.display = "block";
    this.resumeIcon.style.display = "none";
    this.pauseBtnText.textContent = "Pause";
    this.stopBtn.disabled = true;
    this.annotationToggleBtn.disabled = true;
    this.annotationToggleBtn.classList.remove("active");
    this.annotationToggleBtn.querySelector("span").textContent = "Annotate";
    this.selectSourceBtn.disabled = false;
    this.stopBtn.classList.remove("recording");
    this.recordingIndicator.classList.add("hidden");
    this.recordingPill?.classList.add("hidden");
    this.recordingStats?.classList.add("hidden");
    this.recordingManager.stopAudioMeter();
    this.hotkeyOverlay.classList.add("hidden");

    this.annotationManager?.deactivate(true);
    this.recordingManager.isPaused = false;
    this.showQuickSettings();
    this.timerPreset = 0;
    document.querySelectorAll(".timer-preset").forEach((btn) => {
      btn.disabled = true;
      btn.classList.remove("active");
    });
    document
      .querySelector('.timer-preset[data-minutes="0"]')
      ?.classList.add("active");

    const newEmptyBtn = document.getElementById("emptySourceBtn");
    if (newEmptyBtn) {
      newEmptyBtn.addEventListener("click", () =>
        this.sourceManager.openSourceModal(),
      );
    }
  }

  openSettingsModal() {
    document.getElementById("settingsQuality").value =
      this.settings.videoQuality || "high";
    document.getElementById("settingsFrameRate").value =
      this.settings.frameRate || "24";
    document.getElementById("settingsResolution").value =
      this.settings.resolution || "1920x1080";
    document.getElementById("settingsOutputDir").value =
      this.settings.outputDirectory || "";
    document.getElementById("settingsRecordAudio").checked =
      this.settings.recordAudio !== false;
    document.getElementById("settingsCountdown").value =
      this.settings.countdown || 3;
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
    this.updateFileSizeEstimate();
    this.loadRecordingStats();
    this.updateAdvancedSettings();

    this.openModal(this.settingsModal);
  }

  updateAdvancedSettings() {
    if (this.settingsTimerPreset) {
      const timerPreset = this.settings.timerPreset || 0;
      if (timerPreset > 120) {
        this.settingsTimerPreset.value = "custom";
        if (this.settingsCustomTimer)
          this.settingsCustomTimer.value = timerPreset;
        if (this.customTimerGroup)
          this.customTimerGroup.style.display = "block";
      } else {
        this.settingsTimerPreset.value = timerPreset.toString();
        if (this.customTimerGroup) this.customTimerGroup.style.display = "none";
      }
    }

    if (this.settingsScheduledRecording) {
      this.settingsScheduledRecording.checked =
        this.settings.scheduledRecording || false;
      if (this.scheduleTimeGroup) {
        this.scheduleTimeGroup.style.display = this.settings.scheduledRecording
          ? "block"
          : "none";
      }
    }

    if (this.settingsScheduleTime) {
      this.settingsScheduleTime.value = this.settings.scheduleTime || "09:00";
    }

    if (document.getElementById("settingsCountdownSound")) {
      document.getElementById("settingsCountdownSound").checked =
        this.settings.countdownSound !== false;
    }

    if (document.getElementById("settingsAutoHideUI")) {
      document.getElementById("settingsAutoHideUI").checked =
        this.settings.autoHideUI !== false;
    }

    const shortcutKeyEl = document.getElementById("shortcutStartStop");
    if (shortcutKeyEl) {
      shortcutKeyEl.innerHTML = `<kbd>${this.settings.shortcutKey || "F9"}</kbd>`;
    }
  }

  loadRecordingStats() {
    window.electronAPI
      .getRecentRecordings()
      .then((recordings) => {
        if (!recordings || recordings.length === 0) {
          if (this.totalRecordingsEl) this.totalRecordingsEl.textContent = "0";
          if (this.totalDurationEl) this.totalDurationEl.textContent = "0h";
          if (this.totalStorageEl) this.totalStorageEl.textContent = "0 MB";
          return;
        }

        const totalRecordings = recordings.length;
        let totalSize = 0;

        recordings.forEach((r) => {
          totalSize += r.size || 0;
        });

        if (this.totalRecordingsEl)
          this.totalRecordingsEl.textContent = totalRecordings.toString();
        if (this.totalStorageEl)
          this.totalStorageEl.textContent = this.formatFileSize(totalSize);
        if (this.totalDurationEl)
          this.totalDurationEl.textContent =
            "~" + Math.round(totalSize / 5000000) + "m";
      })
      .catch((err) => {
        console.error("Failed to load recent recordings for stats:", err);
      });
  }

  openShortcutsModal() {
    this.closeModal(this.settingsModal);
    setTimeout(() => {
      this.openModal(this.shortcutsModal);
    }, 200);
  }

  async updateHardwareAccelerationOptions() {
    const hwSelect = document.getElementById("settingsHardwareAcceleration");
    let resp = null;
    try {
      resp = await window.electronAPI.getAvailableEncoders();
    } catch (err) {
      console.error("Failed to get available encoders:", err);
      resp = { nvenc: false, qsv: false, amf: false };
    }
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

    try {
      const shouldShow =
        this.availableEncoders &&
        this.availableEncoders.nvenc &&
        this.settings &&
        (this.settings.hardwareAcceleration === "none" ||
          !this.settings.hardwareAcceleration) &&
        !this.settings.nvencPromptDismissed;

      if (shouldShow && this.nvencPrompt) {
        this.nvencPrompt.classList.add("show");
      } else if (this.nvencPrompt) {
        this.nvencPrompt.classList.remove("show");
      }
    } catch (e) {}
  }

  async loadAudioDevicesForSettings() {
    try {
      let audioDevices = [];
      let videoDevices = [];

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: true,
        });
        stream.getTracks().forEach((track) => track.stop());
        const devices = await navigator.mediaDevices.enumerateDevices();
        audioDevices = devices.filter((d) => d.kind === "audioinput");
        videoDevices = devices.filter((d) => d.kind === "videoinput");
      } catch (e) {
        const devices = await navigator.mediaDevices.enumerateDevices();
        audioDevices = devices.filter((d) => d.kind === "audioinput");
        videoDevices = devices.filter((d) => d.kind === "videoinput");
      }

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

      const cameraSelect = document.getElementById("settingsCamera");
      if (cameraSelect) {
        cameraSelect.innerHTML =
          '<option value="default">Default Camera</option>';

        videoDevices.forEach((device) => {
          const option = document.createElement("option");
          option.value = device.deviceId;
          option.textContent =
            device.label || `Camera ${device.deviceId.slice(0, 8)}`;
          cameraSelect.appendChild(option);
        });

        if (this.settings.selectedCamera) {
          cameraSelect.value = this.settings.selectedCamera;
        }
      }
    } catch (err) {
      console.error("Failed to load devices:", err);
    }
  }

  async saveSettings() {
    const shortcutEnabled = document.getElementById("settingsShortcut").checked;
    const timerPresetValue = document.getElementById(
      "settingsTimerPreset",
    ).value;
    const timerPreset =
      timerPresetValue === "custom"
        ? parseInt(document.getElementById("settingsCustomTimer").value) || 45
        : parseInt(timerPresetValue) || 0;

    const newSettings = {
      videoQuality: document.getElementById("settingsQuality").value,
      frameRate: parseInt(document.getElementById("settingsFrameRate").value),
      resolution: document.getElementById("settingsResolution").value,
      outputDirectory: document.getElementById("settingsOutputDir").value,
      recordAudio: document.getElementById("settingsRecordAudio").checked,
      selectedMicrophone: document.getElementById("settingsMicrophone").value,
      hideWindowDuringRecording:
        document.getElementById("settingsHideWindow").checked,
      shortcutEnabled: shortcutEnabled,
      shortcutKey: shortcutEnabled
        ? document.getElementById("settingsShortcutKey").value
        : this.settings.shortcutKey || "F9",
      showNotifications: document.getElementById("settingsShowNotifications")
        .checked,
      countdown: parseInt(document.getElementById("settingsCountdown").value),
      filenamePattern: document.getElementById("settingsFilenamePattern").value,
      compression: document.getElementById("settingsCompression").value,
      hardwareAcceleration: document.getElementById(
        "settingsHardwareAcceleration",
      ).value,
      defaultFormat: document.getElementById("settingsFormat").value,
      autoSave: document.getElementById("settingsAutoSave").checked,
      autoOpenAfterRecording:
        document.getElementById("settingsAutoOpen").checked,
      timerPreset: timerPreset,
      scheduledRecording: document.getElementById("settingsScheduledRecording")
        .checked,
      scheduleTime: document.getElementById("settingsScheduleTime").value,
      countdownSound: document.getElementById("settingsCountdownSound").checked,
      autoHideUI: document.getElementById("settingsAutoHideUI").checked,
      webcamEnabled: document.getElementById("settingsWebcam").checked,
      selectedCamera:
        document.getElementById("settingsCamera")?.value || "default",
      webcamPosition: document.getElementById("settingsWebcamPosition").value,
      webcamSize: document.getElementById("settingsWebcamSize").value,
    };

    try {
      this.settings = await window.electronAPI.saveSettings(newSettings);
      this.applySettings();
      this.updateQuickSettings();
      this.updateTimerPresetFromSettings();
      this.closeModal(this.settingsModal);
      this.showToast("Settings saved", "success");
    } catch (err) {
      this.showToast("Failed to save settings", "error");
      console.error(err);
    }
  }

  updateTimerPresetFromSettings() {
    this.timerPreset = this.settings.timerPreset || 0;
    if (this.timerPreset > 0 && this.timerPreset !== this.recordingTimeout) {
      const presetBtn = document.querySelector(
        `.timer-preset[data-minutes="${Math.min(this.timerPreset, 30)}"]`,
      );
      if (presetBtn) {
        document
          .querySelectorAll(".timer-preset")
          .forEach((b) => b.classList.remove("active"));
        presetBtn.classList.add("active");
      }
    }
  }

  closeModal(modal) {
    this.uiManager.closeModal(modal);
  }

  openModal(modal) {
    this.uiManager.openModal(modal);
  }

  async toggleMaximize() {
    try {
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
    } catch (err) {
      console.error("Failed to toggle maximize:", err);
    }
  }

  destroy() {
    try {
      // Stop recording if active
      if (this.recordingManager?.isRecording) {
        this.recordingManager
          .stopRecording()
          .catch((err) =>
            console.warn("Error stopping recording on cleanup:", err),
          );
      }

      // Destroy managers
      if (this.recordingManager) {
        this.recordingManager.destroy();
        this.recordingManager = null;
      }

      if (this.annotationManager) {
        this.annotationManager.destroy();
        this.annotationManager = null;
      }

      if (this.sourceManager) {
        this.sourceManager.destroy();
        this.sourceManager = null;
      }

      // Remove document-level event listeners
      if (this.keydownHandler) {
        document.removeEventListener("keydown", this.keydownHandler);
        this.keydownHandler = null;
      }

      // Cancel any pending animation frames
      if (this.cropDrawId) {
        cancelAnimationFrame(this.cropDrawId);
        this.cropDrawId = null;
      }

      if (this.recordingTimeout) {
        clearTimeout(this.recordingTimeout);
        this.recordingTimeout = null;
      }

      // Clean up element references
      this.previewVideo = null;
      this.uiManager = null;
      this.settings = null;

      console.log("ScreenRecorder cleanup complete");
    } catch (err) {
      console.error("Error during ScreenRecorder cleanup:", err);
    }
  }

  showToast(message, type = "info") {
    this.uiManager.showToast(message, type);
  }

  runCountdown(seconds) {
    return this.uiManager.runCountdown(seconds);
  }

  showCompletionOptions(filePath) {
    const toast = document.createElement("div");
    toast.className = "toast success";
    toast.innerHTML = `
      <span class="toast-message">Recording saved!</span>
      <div class="toast-buttons">
        <button class="toast-btn" id="openLocation">Open Location</button>
        <button class="toast-btn primary" id="playVideo">Play</button>
        <button class="toast-btn" id="closeToast">Close</button>
      </div>
    `;

    this.toastContainer.appendChild(toast);

    document
      .getElementById("openLocation")
      ?.addEventListener("click", async () => {
        try {
          await window.electronAPI.openFileLocation(filePath);
        } catch (err) {
          console.error("Failed to open file location:", err);
          this.showToast("Failed to open file location", "error");
        }
      });

    document
      .getElementById("playVideo")
      ?.addEventListener("click", async () => {
        try {
          await window.electronAPI.openFile(filePath);
        } catch (err) {
          console.error("Failed to open file:", err);
          this.showToast("Failed to open file", "error");
        }
      });

    document.getElementById("closeToast")?.addEventListener("click", () => {
      toast.remove();
    });

    setTimeout(() => toast.remove(), 15000);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const recorder = new ScreenRecorder();

  // Initialize performance dashboard
  const PerformanceDashboard = window.PerformanceDashboard;
  if (PerformanceDashboard && recorder.recordingManager?.monitor) {
    const dashboard = new PerformanceDashboard(
      recorder,
      recorder.recordingManager.monitor,
    );
    dashboard.init();

    // Add keyboard shortcut to toggle dashboard (Ctrl+Shift+P)
    document.addEventListener("keydown", (e) => {
      if (e.ctrlKey && e.shiftKey && e.code === "KeyP") {
        e.preventDefault();
        dashboard.toggle();
      }
    });
  }

  // Add cleanup on window unload
  window.addEventListener("beforeunload", () => {
    recorder.destroy();
  });

  window.addEventListener("unload", () => {
    recorder.destroy();
  });
});
