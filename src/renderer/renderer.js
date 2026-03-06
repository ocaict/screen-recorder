class ScreenRecorder {
  constructor() {
    this.settings = {};
    this.recordingManager = null;
    this.sourceManager = null;
    this.uiManager = null;
    this.annotationManager = null;
    this.settingsHandler = null;
    this.recentRecordingsManager = null;
    this.timerControls = null;
    this.overlayAnnotationActive = false;
    this.selectionMode = false;
    this.selectedPaths = new Set();
    this.isQuitting = false;
    this.timerPreset = 0;
    this.document = document;

    this.initialize();
  }

  async initialize() {
    this.uiManager = new UIManager(this);
    this.uiManager.initializeElements();

    this.settingsHandler = new SettingsHandler(this);
    this.recentRecordingsManager = new RecentRecordingsManager(this);
    this.timerControls = new TimerControls(this);

    let monitor = null;
    if (window.PerformanceMonitor) {
      monitor = new window.PerformanceMonitor();
    }

    this.recordingManager = new RecordingManager(this, monitor);
    this.sourceManager = new SourceManager(this);
    this.annotationManager = new AnnotationManager(this);
    this.annotationManager.init();

    await this.recordingManager.init();

    await this.settingsHandler.loadSettings();
    this.initializeEventListeners();
    this.initializeIPCListeners();
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
          // Unified stream setup for both preview and recording.
          // This fixes the '3 streams' issue and uses RAF for performance.
          await this.recordingManager.setupRegionStream(false);

          // Show the red guide border immediately after selection
          if (window.electronAPI.showRegionIndicator) {
            window.electronAPI.showRegionIndicator(region);
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


    // ── Live-relay annotation toolbar selections into the overlay ────────────
    // Tool selector buttons
    document.querySelectorAll(".annotation-btn[data-tool]").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (this.overlayAnnotationActive) {
          window.electronAPI.sendOverlaySettings({ tool: btn.dataset.tool });
        }
      });
    });

    // Colour picker buttons
    document.querySelectorAll(".annotation-color-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (this.overlayAnnotationActive) {
          window.electronAPI.sendOverlaySettings({ color: btn.dataset.color });
        }
      });
    });

    // Undo button
    document.getElementById("annotationUndo")?.addEventListener("click", () => {
      if (this.overlayAnnotationActive) {
        window.electronAPI.sendOverlayCommand("undo");
      }
    });

    // Clear button
    document
      .getElementById("annotationClear")
      ?.addEventListener("click", () => {
        if (this.overlayAnnotationActive) {
          window.electronAPI.sendOverlayCommand("clear");
        }
      });
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
    this.saveSettingsBtn.addEventListener("click", () => this.settingsHandler.saveSettings());

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
      ?.addEventListener("click", () => this.settingsHandler.resetSettings());


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
      .getElementById("settingsRecordSystemAudio")
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

    document
      .getElementById("settingsTimerPreset")
      ?.addEventListener("change", (e) => {
        const customTimerGroup = document.getElementById("customTimerGroup");
        if (customTimerGroup) {
          customTimerGroup.style.display =
            e.target.value === "custom" ? "block" : "none";
        }
      });

    document
      .getElementById("settingsScheduledRecording")
      ?.addEventListener("change", (e) => {
        const scheduleTimeGroup = document.getElementById("scheduleTimeGroup");
        if (scheduleTimeGroup) {
          scheduleTimeGroup.style.display = e.target.checked ? "block" : "none";
        }
      });


    document
      .getElementById("settingsIdleDetection")
      ?.addEventListener("change", (e) => {
        const idleTimeoutGroup = document.getElementById("idleTimeoutGroup");
        if (idleTimeoutGroup) {
          idleTimeoutGroup.style.display = e.target.checked ? "block" : "none";
        }
      });

    const qualityControlSelect = document.getElementById(
      "settingsQualityControl",
    );
    const crfGroup = document.getElementById("crfControlGroup");
    const vbrGroup = document.getElementById("vbrControlGroup");
    const crfInput = document.getElementById("settingsCrfValue");
    const vbrInput = document.getElementById("settingsVideoBitrate");
    const crfDisplay = document.getElementById("crfValueDisplay");
    const vbrDisplay = document.getElementById("vbrValueDisplay");

    if (qualityControlSelect) {
      qualityControlSelect.addEventListener("change", (e) => {
        if (crfGroup && vbrGroup) {
          crfGroup.style.display = e.target.value === "crf" ? "block" : "none";
          vbrGroup.style.display = e.target.value === "vbr" ? "block" : "none";
        }
      });
    }

    if (crfInput && crfDisplay) {
      crfInput.addEventListener("input", (e) => {
        crfDisplay.textContent = e.target.value;
      });
    }

    if (vbrInput && vbrDisplay) {
      vbrInput.addEventListener("input", (e) => {
        vbrDisplay.textContent = e.target.value;
      });
    }

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

    if (this.toggleSelectBtn) {
      this.toggleSelectBtn.addEventListener("click", () =>
        this.toggleSelectionMode(),
      );
    }

    if (this.mergeRecordingsBtn) {
      this.mergeRecordingsBtn.addEventListener("click", () =>
        this.handleMerge(),
      );
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

    // Click Highlights Popover
    const clickHighlightsBtn = document.getElementById(
      "clickHighlightsSettingsBtn",
    );
    const clickHighlightsPopover = document.getElementById(
      "clickHighlightsPopover",
    );
    const closeClickHighlightsPopover = document.getElementById(
      "closeClickHighlightsPopover",
    );

    if (clickHighlightsBtn && clickHighlightsPopover) {
      clickHighlightsBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        clickHighlightsPopover.classList.toggle("show");
      });
    }
    if (closeClickHighlightsPopover && clickHighlightsPopover) {
      closeClickHighlightsPopover.addEventListener("click", () => {
        clickHighlightsPopover.classList.remove("show");
      });
    }
    document.addEventListener("click", (e) => {
      if (
        clickHighlightsPopover &&
        !clickHighlightsPopover.contains(e.target) &&
        !clickHighlightsBtn?.contains(e.target)
      ) {
        clickHighlightsPopover.classList.remove("show");
      }
    });

    // Range slider value displays
    const highlightRippleSize = document.getElementById("highlightRippleSize");
    const rippleSizeValue = document.getElementById("rippleSizeValue");
    if (highlightRippleSize && rippleSizeValue) {
      highlightRippleSize.addEventListener("input", () => {
        rippleSizeValue.textContent = highlightRippleSize.value;
      });
    }
    const highlightRippleSpeed = document.getElementById(
      "highlightRippleSpeed",
    );
    const rippleSpeedValue = document.getElementById("rippleSpeedValue");
    if (highlightRippleSpeed && rippleSpeedValue) {
      highlightRippleSpeed.addEventListener("input", () => {
        rippleSpeedValue.textContent = highlightRippleSpeed.value;
      });
    }
    const highlightGlowSize = document.getElementById("highlightGlowSize");
    const glowSizeValue = document.getElementById("glowSizeValue");
    if (highlightGlowSize && glowSizeValue) {
      highlightGlowSize.addEventListener("input", () => {
        glowSizeValue.textContent = highlightGlowSize.value;
      });
    }
    const highlightGlowIntensity = document.getElementById(
      "highlightGlowIntensity",
    );
    const glowIntensityValue = document.getElementById("glowIntensityValue");
    if (highlightGlowIntensity && glowIntensityValue) {
      highlightGlowIntensity.addEventListener("input", () => {
        glowIntensityValue.textContent = highlightGlowIntensity.value;
      });
    }

    // Trim Modal Listeners
    if (this.trimStartRange) {
      this.trimStartRange.addEventListener("input", () =>
        this.updateTrimRange(),
      );
    }
    if (this.trimEndRange) {
      this.trimEndRange.addEventListener("input", () => this.updateTrimRange());
    }
    if (this.cancelTrimBtn) {
      this.cancelTrimBtn.addEventListener("click", () =>
        this.closeModal(this.trimModal),
      );
    }
    if (this.closeTrimModal) {
      this.closeTrimModal.addEventListener("click", () =>
        this.closeModal(this.trimModal),
      );
    }
    if (this.saveTrimBtn) {
      this.saveTrimBtn.addEventListener("click", () => this.handleTrimSave());
    }
    if (this.saveGifBtn) {
      this.saveGifBtn.addEventListener("click", () => this.handleGifSave());
    }

    if (this.trimStartTimeInput) {
      this.trimStartTimeInput.addEventListener("change", () => {
        const seconds = this.timeToSeconds(this.trimStartTimeInput.value);
        if (!isNaN(seconds)) {
          this.trimStartRange.value =
            (seconds / this.trimVideoPreview.duration) * 100;
          this.updateTrimRange();
        }
      });
    }
    if (this.trimEndTimeInput) {
      this.trimEndTimeInput.addEventListener("change", () => {
        const seconds = this.timeToSeconds(this.trimEndTimeInput.value);
        if (!isNaN(seconds)) {
          this.trimEndRange.value =
            (seconds / this.trimVideoPreview.duration) * 100;
          this.updateTrimRange();
        }
      });
    }



    // Initialize Webcam
    this.setupWebcamSettingsListeners();
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
        this.isQuitting = true;
        await this.recordingManager.stopRecording(true);
        await new Promise((resolve) => setTimeout(resolve, 100));
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
      if (this.isQuitting) return;
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
      if (this.isQuitting) return;
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
          recovering: "Recovering recording as WebM...",
        };
        this.processingStatus.textContent =
          progress.status || stageMessages[progress.stage] || "Processing...";
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
      if (this.isQuitting) return;
      try {
        this.processingOverlay.classList.remove("active");

        const fileName = filePath.split(/[\\\/]/).pop();
        const isMp4 = filePath.toLowerCase().endsWith(".mp4");
        const isGif = filePath.toLowerCase().endsWith(".gif");
        const isMerged = fileName.startsWith("Merged_");

        if (isGif) {
          this.showToast(`GIF exported successfully: ${fileName}`, "success");
        } else if (isMerged) {
          this.showToast("Videos merged successfully", "success");
        } else if (isMp4) {
          this.showToast(`Conversion complete: ${fileName}`, "success");
        } else {
          this.showToast(`Recording saved: ${fileName}`, "success");
        }

        try {
          const settings = await window.electronAPI.getSettings();
          if (settings && settings.autoOpenAfterRecording && !isMerged) {
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

    window.electronAPI.onWindowMinimized(() => {
      console.log("[Webcam] Main window minimized");
    });

    window.electronAPI.onWindowRestored(() => {
      console.log("[Webcam] Main window restored");
    });

    // Relay overlay drawing actions to the local annotation manager (for compositing)
    window.electronAPI.onOverlayAction((action) => {
      if (this.annotationManager) {
        this.annotationManager.handleOverlayAction(action);
      }
    });

    window.electronAPI.onError((error) => {
      this.processingOverlay.classList.remove("active");
      this.showToast(error.message || "An error occurred", "error");
    });
  }

  async loadSettings() {
    return this.settingsHandler.loadSettings();
  }

  async loadRecentRecordings() {
    return this.recentRecordingsManager.loadRecentRecordings();
  }

  displayRecentRecordings(recordings) {
    return this.recentRecordingsManager.displayRecentRecordings(recordings);
  }

  formatFileSize(bytes) {
    return this.uiManager.formatFileSize(bytes);
  }

  async loadRecentRecordings() {
    return this.recentRecordingsManager.loadRecentRecordings();
  }

  displayRecentRecordings(recordings) {
    return this.recentRecordingsManager.displayRecentRecordings(recordings);
  }

  updateQuickSettings() {
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
        <div class="recent-recording-item ${this.selectedPaths.has(recording.filePath) ? "selected" : ""}" role="listitem" data-path="${recording.filePath}" title="${recording.filePath}" tabindex="0" aria-label="${recording.fileName}, ${dateStr}, ${sizeStr}">
          <input type="checkbox" class="recording-checkbox" ${this.selectedPaths.has(recording.filePath) ? "checked" : ""} aria-hidden="true" tabindex="-1">
          <div class="recent-recording-thumb">
            ${recording.thumbnailPath
            ? `<img src="thumb://${recording.thumbnailPath}" class="recent-recording-img" alt="">`
            : `<svg class="recent-recording-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                    <polygon points="5,3 19,12 5,21"/>
                  </svg>`
          }
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
            <button class="btn-action btn-trim" data-path="${recording.filePath}" title="Trim video" aria-label="Trim ${recording.fileName}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="6" cy="6" r="3"/><path d="M8.12 8.12 12 12"/><circle cx="6" cy="18" r="3"/><path d="M9.8 14.84 12 12"/><path d="M12 12 20 4"/><path d="M12 12 20 20"/>
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
        const handleRecordingClick = async (e) => {
          const filePath = item.dataset.path;

          if (this.selectionMode) {
            e.preventDefault();
            const checkbox = item.querySelector(".recording-checkbox");
            if (this.selectedPaths.has(filePath)) {
              this.selectedPaths.delete(filePath);
              item.classList.remove("selected");
              if (checkbox) checkbox.checked = false;
            } else {
              this.selectedPaths.add(filePath);
              item.classList.add("selected");
              if (checkbox) checkbox.checked = true;
            }

            // Update Merge button state/text
            const count = this.selectedPaths.size;
            this.mergeRecordingsBtn.textContent =
              count > 0 ? `Merge (${count})` : "Merge";
            this.mergeRecordingsBtn.disabled = count < 2;
            return;
          }

          if (e.target.closest(".btn-action")) return;
          try {
            await window.electronAPI.openFile(filePath);
          } catch (err) {
            console.error("Failed to open recording:", err);
            this.showToast("Failed to open recording", "error");
          }
        };

        item.addEventListener("click", handleRecordingClick);
        item.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleRecordingClick(e);
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

    this.recentRecordingsList.querySelectorAll(".btn-trim").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const filePath = btn.dataset.path;
        this.openTrimModal(filePath);
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
    return this.timerControls.updateFileSizeEstimate();
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
              : resolution === "native"
                ? "Native"
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
    // cameraMode is a runtime-only field (not persisted through save-settings IPC round-trip).
    // Always restore from our in-memory value so disk reads don't overwrite it.
    const preservedCameraMode = this._runtimeCameraMode || this.settings.cameraMode || "corner";
    this.settings.cameraMode = preservedCameraMode;

    document.getElementById("settingsQuality").value =
      this.settings.videoQuality || "high";
    document.getElementById("settingsFrameRate").value =
      this.settings.frameRate || "24";
    document.getElementById("settingsResolution").value =
      this.settings.resolution || "1920x1080";
    document.getElementById("settingsRecordAudio").checked =
      this.settings.recordAudio !== false;
    document.getElementById("settingsRecordSystemAudio").checked =
      this.settings.recordSystemAudio || false;
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
    if (document.getElementById("settingsRecordDirectToMp4")) {
      document.getElementById("settingsRecordDirectToMp4").checked =
        this.settings.recordDirectToMp4 !== false;
    }

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

      // Update actual UI components based on webcam setting
      const webcamEnabled = this.settings.webcamEnabled === true;
      const hasStream = !!this.recordingManager?.webcamStream;
      console.log(
        `[Webcam] applySettings: enabled=${webcamEnabled}, hasStream=${hasStream}`,
      );

      // Handle Floating Camera Window
      if (window.electronAPI.toggleCameraWindow) {
        window.electronAPI.toggleCameraWindow(webcamEnabled);
        // Only send size/device here, NEVER cameraMode - that's managed by togglePresenterMode
        if (webcamEnabled && window.electronAPI.updateCameraSettings) {
          window.electronAPI.updateCameraSettings({
            webcamSize: this.settings.webcamSize,
            selectedCamera: this.settings.selectedCamera,
            // cameraMode intentionally omitted - controlled only by togglePresenterMode
          });
        }
      }
    }

    if (document.getElementById("settingsIdleDetection")) {
      document.getElementById("settingsIdleDetection").checked =
        this.settings.idleDetectionEnabled || false;
      const idleTimeoutGroup = document.getElementById("idleTimeoutGroup");
      if (idleTimeoutGroup) {
        idleTimeoutGroup.style.display = this.settings.idleDetectionEnabled
          ? "block"
          : "none";
      }
    }
    if (document.getElementById("settingsIdleTimeout")) {
      document.getElementById("settingsIdleTimeout").value =
        this.settings.idleTimeoutMinutes || 5;
    }
    if (document.getElementById("settingsMemoryThreshold")) {
      document.getElementById("settingsMemoryThreshold").value =
        this.settings.memoryThresholdMB || 500;
    }
  }

  async loadAudioDevices() { }

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

  async toggleAnnotation() {
    const isActive = this.overlayAnnotationActive;

    if (isActive) {
      // ── Deactivate overlay ───────────────────────────────────────────────
      try {
        await window.electronAPI.setOverlayDrawMode(false);
        await window.electronAPI.hideOverlay();
      } catch (e) {
        console.warn("Failed to deactivate overlay:", e);
      }
      this.overlayAnnotationActive = false;
      this.annotationToggleBtn.classList.remove("active");
      this.annotationToggleBtn.querySelector("span").textContent = "Annotate";

      // Also hide the tools toolbar in the main app
      if (this.annotationManager) {
        this.annotationManager.deactivate(true);
      }

      this.showToast("Annotation overlay hidden", "info");
    } else {
      // ── Activate overlay ─────────────────────────────────────────────────
      // Get display ID from selected source (:Y or windowformat: screen:X:X:Y)
      let displayId = null;
      const selectedSource = this.recordingManager?.selectedSource;
      if (selectedSource?.id) {
        const match = selectedSource.id.match(/^screen:(\d+):/);
        if (match) {
          displayId = parseInt(match[1], 10);
        }
      }

      try {
        await window.electronAPI.showOverlay(displayId);
        // Wait for overlay to be fully ready
        await new Promise((r) => setTimeout(r, 300));
        window.electronAPI.setOverlayDrawMode(true);

        // Clear any leftover drawings from a previous session
        if (window.electronAPI.sendOverlayCommand) {
          window.electronAPI.sendOverlayCommand("clear");
        }

        // Push current toolbar selections into the overlay immediately
        window.electronAPI.sendOverlaySettings({
          tool: this.annotationManager?.currentTool || "pen",
          color: this.annotationManager?.currentColor || "#ff0000",
          width: this.annotationManager?.strokeWidth || 3,
        });
      } catch (e) {
        console.error("Failed to activate overlay:", e);
      }
      this.overlayAnnotationActive = true;
      this.annotationToggleBtn.classList.add("active");
      this.annotationToggleBtn.querySelector("span").textContent = "Drawing";

      // Also show the tools toolbar in the main app
      if (this.annotationManager) {
        this.annotationManager.clearAll(); // Clear any leftover drawings
        this.annotationManager.activate(true);
      }

      this.showToast(
        "Annotation mode active. Use the toolbar to draw.",
        "info",
      );
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

    // Show/Update Webcam Controls
    if (this.settings.webcamEnabled && this.recordingManager.webcamStream) {
      if (window.electronAPI.toggleCameraWindow) {
        window.electronAPI.toggleCameraWindow(true);
      }

      // Start syncing floating camera position to compositor
      this.startCameraSyncTask();

      // Ensure stream is piped for local recording compositor
      if (
        this.webcamPreviewVideo &&
        this.webcamPreviewVideo.srcObject !== this.recordingManager.webcamStream
      ) {
        this.webcamPreviewVideo.srcObject = this.recordingManager.webcamStream;
      }
    } else {
      if (window.electronAPI.toggleCameraWindow) {
        window.electronAPI.toggleCameraWindow(false);
      }
      this.stopCameraSyncTask();
      if (this.webcamPreviewVideo) this.webcamPreviewVideo.srcObject = null;
    }
  }

  startCameraSyncTask() {
    this.stopCameraSyncTask();
    this.cameraSyncInterval = setInterval(async () => {
      await this.syncFloatingCameraPosition();
    }, 100); // 10fps sync for position is enough
  }

  stopCameraSyncTask() {
    if (this.cameraSyncInterval) {
      clearInterval(this.cameraSyncInterval);
      this.cameraSyncInterval = null;
    }
  }

  async syncFloatingCameraPosition() {
    if (!this.recordingManager?.isRecording || !this.settings.webcamEnabled) return;

    // Don't override compositor coordinates during presenter mode animation
    if (this.settings.cameraMode === "center") return;

    try {
      const bounds = await window.electronAPI.getCameraWindowBounds();
      if (!bounds) return;

      // Determine the bounds of the surface being recorded
      let surfaceWidth, surfaceHeight, offsetX = 0, offsetY = 0;

      const recordingRegion = this.recordingManager.selectedRegion;
      const selectedSource = this.recordingManager.selectedSource;

      if (recordingRegion) {
        surfaceWidth = recordingRegion.width;
        surfaceHeight = recordingRegion.height;
        offsetX = recordingRegion.x;
        offsetY = recordingRegion.y;
      } else if (selectedSource?.id?.startsWith("screen:")) {
        const displays = await window.electronAPI.getDisplays();
        const screenIdMatch = selectedSource.id.match(/screen:(\d+):/);
        const displayIndex = screenIdMatch ? parseInt(screenIdMatch[1], 10) : 0;
        const display = displays[displayIndex] || displays[0];

        surfaceWidth = display.bounds.width;
        surfaceHeight = display.bounds.height;
        offsetX = display.bounds.x;
        offsetY = display.bounds.y;
      } else {
        surfaceWidth = window.screen.width;
        surfaceHeight = window.screen.height;
      }

      // Use the CENTER of the camera window for mapping, then normalize
      // relative to the recording surface's coordinate space.
      // webcamCustomX/Y are the normalized top-left corner of the webcam overlay
      // in the compositor's canvas.

      // IMPORTANT: Use the SAME proportional sizing as compositor-worker.js
      // The compositor uses: config.width * 0.0625/0.09375/0.125
      // We need canvas resolution, not surface resolution
      const sizeMap = { small: 0.0625, medium: 0.09375, large: 0.125 };
      const sizeRatio = sizeMap[this.settings.webcamSize || "medium"];

      // Get canvas dimensions from the compositor
      let canvasWidth = surfaceWidth;
      let canvasHeight = surfaceHeight;
      if (this.recordingManager.compositorCanvasElement) {
        canvasWidth = this.recordingManager.compositorCanvasElement.width;
        canvasHeight = this.recordingManager.compositorCanvasElement.height;
      }

      const webcamPixelSize = canvasWidth * sizeRatio;

      // FIX: The camera window is positioned on screen, but we need to map it to the canvas.
      // The key insight: the canvas represents the captured screen area.
      // 
      // NEW APPROACH: Find which display the camera window is on, and map its position
      // to the canvas coordinates. The canvas already represents the captured area.
      let cameraRelX, cameraRelY;

      const displays = await window.electronAPI.getDisplays();

      // Find which display contains the camera window center
      const camCenterX = bounds.x + bounds.width / 2;
      const camCenterY = bounds.y + bounds.height / 2;

      let cameraDisplay = displays[0]; // default to primary
      for (const display of displays) {
        const d = display.bounds;
        if (camCenterX >= d.x && camCenterX < d.x + d.width &&
          camCenterY >= d.y && camCenterY < d.y + d.height) {
          cameraDisplay = display;
          break;
        }
      }

      // Camera position relative to its own display
      cameraRelX = bounds.x - cameraDisplay.bounds.x;
      cameraRelY = bounds.y - cameraDisplay.bounds.y;

      // Now normalize to the camera's display dimensions (not canvas)
      // This gives us the relative position (0-1) within the display
      // The compositor will apply this same relative position to the canvas
      const camDisplayWidth = cameraDisplay.bounds.width;
      const camDisplayHeight = cameraDisplay.bounds.height;

      let normX = cameraRelX / (camDisplayWidth - webcamPixelSize || 1);
      let normY = cameraRelY / (camDisplayHeight - webcamPixelSize || 1);

      // Clamp to 0-1
      normX = Math.max(0, Math.min(1, normX));
      normY = Math.max(0, Math.min(1, normY));

      if (this.recordingManager.compositorWorker) {
        this.recordingManager.compositorWorker.postMessage({
          type: "updateSettings",
          payload: {
            webcamCustomX: normX,
            webcamCustomY: normY,
            includeWebcam: true
          }
        });

        // Detailed logging for debugging coordinate shifts
        console.log(`[CamSync] camWin=(${bounds.x},${bounds.y}) camDisplay=${cameraDisplay.bounds.x},${cameraDisplay.bounds.y} camRel=(${cameraRelX},${cameraRelY}) canvas=${canvasWidth}x${canvasHeight} => norm=(${normX.toFixed(3)},${normY.toFixed(3)})`);
      }
    } catch (err) {
      console.warn("Failed to sync floating camera position:", err);
    }
  }

  updateUIForStopped() {
    this.stopCameraSyncTask();
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
    if (this.webcamPreviewVideo) this.webcamPreviewVideo.srcObject = null;

    // Hide the transparent overlay and clean up old in-app canvas too
    if (this.overlayAnnotationActive) {
      if (window.electronAPI.sendOverlayCommand) {
        window.electronAPI.sendOverlayCommand("clear");
      }
      window.electronAPI.setOverlayDrawMode(false);
      window.electronAPI.hideOverlay().catch(() => { });
      this.overlayAnnotationActive = false;
    }
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
    return this.settingsHandler.openSettingsModal();
  }

  populateSettingsUI() {
    document.getElementById("settingsHideWindow").checked =
      this.settings.hideWindowDuringRecording || false;
    document.getElementById("settingsShortcut").checked =
      this.settings.shortcutEnabled !== false;
    document.getElementById("settingsShortcutKey").value =
      this.settings.shortcutKey || "F9";
    document.getElementById("settingsShowNotifications").checked =
      this.settings.showNotifications !== false;
    if (document.getElementById("settingsShowMiniControls")) {
      document.getElementById("settingsShowMiniControls").checked =
        this.settings.showMiniControls !== false;
    }
    if (document.getElementById("settingsShowClickHighlights")) {
      document.getElementById("settingsShowClickHighlights").checked =
        this.settings.showClickHighlights !== false;
    }
    if (document.getElementById("highlightLeftColor")) {
      document.getElementById("highlightLeftColor").value =
        this.settings.highlightLeftColor || "#FFEB3B";
    }
    if (document.getElementById("highlightRightColor")) {
      document.getElementById("highlightRightColor").value =
        this.settings.highlightRightColor || "#2196F3";
    }
    if (document.getElementById("highlightRippleSize")) {
      document.getElementById("highlightRippleSize").value =
        this.settings.highlightRippleSize || 50;
      document.getElementById("rippleSizeValue").textContent =
        this.settings.highlightRippleSize || 50;
    }
    if (document.getElementById("highlightRippleSpeed")) {
      document.getElementById("highlightRippleSpeed").value =
        this.settings.highlightRippleSpeed || 400;
      document.getElementById("rippleSpeedValue").textContent =
        this.settings.highlightRippleSpeed || 400;
    }
    if (document.getElementById("highlightGlowSize")) {
      document.getElementById("highlightGlowSize").value =
        this.settings.highlightGlowSize || 25;
      document.getElementById("glowSizeValue").textContent =
        this.settings.highlightGlowSize || 25;
    }
    if (document.getElementById("highlightGlowIntensity")) {
      document.getElementById("highlightGlowIntensity").value =
        this.settings.highlightGlowIntensity || 30;
      document.getElementById("glowIntensityValue").textContent =
        this.settings.highlightGlowIntensity || 30;
    }
    if (document.getElementById("settingsIdleDetection")) {
      document.getElementById("settingsIdleDetection").checked =
        this.settings.idleDetectionEnabled || false;
      const idleTimeoutGroup = document.getElementById("idleTimeoutGroup");
      if (idleTimeoutGroup) {
        idleTimeoutGroup.style.display = this.settings.idleDetectionEnabled
          ? "block"
          : "none";
      }
    }
    if (document.getElementById("settingsIdleTimeout")) {
      document.getElementById("settingsIdleTimeout").value =
        this.settings.idleTimeoutMinutes || 5;
    }
    if (document.getElementById("settingsMemoryThreshold")) {
      document.getElementById("settingsMemoryThreshold").value =
        this.settings.memoryThresholdMB || 500;
    }

    // Advanced Settings
    if (document.getElementById("settingsVideoCodec")) {
      document.getElementById("settingsVideoCodec").value =
        this.settings.videoCodec || "libx264";
    }
    if (document.getElementById("settingsQualityControl")) {
      document.getElementById("settingsQualityControl").value =
        this.settings.qualityControl || "crf";

      const crfGroup = document.getElementById("crfControlGroup");
      const vbrGroup = document.getElementById("vbrControlGroup");
      if (crfGroup && vbrGroup) {
        crfGroup.style.display =
          (this.settings.qualityControl || "crf") === "crf" ? "block" : "none";
        vbrGroup.style.display =
          (this.settings.qualityControl || "crf") === "vbr" ? "block" : "none";
      }
    }
    if (document.getElementById("settingsCrfValue")) {
      document.getElementById("settingsCrfValue").value =
        this.settings.crfValue || 23;
      if (document.getElementById("crfValueDisplay")) {
        document.getElementById("crfValueDisplay").textContent =
          this.settings.crfValue || 23;
      }
    }
    if (document.getElementById("settingsVideoBitrate")) {
      document.getElementById("settingsVideoBitrate").value =
        this.settings.videoBitrate || 5;
      if (document.getElementById("vbrValueDisplay")) {
        document.getElementById("vbrValueDisplay").textContent =
          this.settings.videoBitrate || 5;
      }
    }
    if (document.getElementById("settingsColorFormat")) {
      document.getElementById("settingsColorFormat").value =
        this.settings.colorFormat || "yuv420p";
    }

    this.openModal(this.settingsModal);
    this.updateFileSizeEstimate();
    this.loadAudioDevicesForSettings();
    this.loadRecordingStats();
    this.updateAdvancedSettings();
    this.updateHardwareAccelerationOptions();
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


    if (document.getElementById("settingsShowMiniControls")) {
      document.getElementById("settingsShowMiniControls").checked =
        this.settings.showMiniControls !== false;
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
    const hwLoading = document.getElementById("hwLoading");

    if (hwLoading) hwLoading.style.display = "inline";

    let resp = null;
    try {
      resp = await window.electronAPI.getAvailableEncoders();
    } catch (err) {
      console.error("Failed to get available encoders:", err);
      resp = { nvenc: false, qsv: false, amf: false };
    }

    if (hwLoading) hwLoading.style.display = "none";

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
    } catch (e) { }
  }

  async loadAudioDevicesForSettings() {
    try {
      let audioDevices = [];
      let videoDevices = [];

      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        audioDevices = devices.filter((d) => d.kind === "audioinput");
        videoDevices = devices.filter((d) => d.kind === "videoinput");
      } catch (e) {
        console.warn("Failed to enumerate devices:", e);
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
    return this.settingsHandler.saveSettings();
  }

  updateTimerPresetFromSettings() {
    return this.settingsHandler.updateTimerPresetFromSettings();
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

  saveSettings() {
    if (this.settingsHandler) {
      // Return the promise from the main process call
      const savePromise = window.electronAPI.saveSettings(this.settings);
      this.settingsHandler.updateQuickSettings();
      return savePromise;
    }
    return Promise.resolve();
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
        <button class="toast-btn" id="trimVideo">Trim</button>
        <button class="toast-btn" id="closeToast">Close</button>
      </div>
    `;

    this.toastContainer.appendChild(toast);

    toast
      .querySelector("#openLocation")
      ?.addEventListener("click", async () => {
        try {
          await window.electronAPI.openFileLocation(filePath);
        } catch (err) {
          console.error("Failed to open file location:", err);
          this.showToast("Failed to open file location", "error");
        }
      });

    toast.querySelector("#playVideo")?.addEventListener("click", async () => {
      try {
        await window.electronAPI.openFile(filePath);
      } catch (err) {
        console.error("Failed to open file:", err);
        this.showToast("Failed to open file", "error");
      }
    });

    toast.querySelector("#trimVideo")?.addEventListener("click", () => {
      toast.remove();
      this.openTrimModal(filePath);
    });

    toast.querySelector("#closeToast")?.addEventListener("click", () => {
      toast.remove();
    });

    // Increase timeout to 30 seconds for recording completion options
    setTimeout(() => {
      if (toast.parentNode) toast.remove();
    }, 30000);
  }

  async openTrimModal(filePath) {
    this.currentTrimPath = filePath;
    this.trimVideoPreview.src = `file://${filePath}`;
    this.openModal(this.trimModal);

    this.trimVideoPreview.onloadedmetadata = () => {
      const duration = this.trimVideoPreview.duration;
      this.trimStartRange.value = 0;
      this.trimEndRange.value = 100;
      this.trimStartTimeInput.value = "00:00:00";
      this.trimEndTimeInput.value = this.formatSeconds(duration);
      this.updateTrimRange();
    };
  }

  updateTrimRange() {
    const startPercent = parseFloat(this.trimStartRange.value);
    const endPercent = parseFloat(this.trimEndRange.value);
    const duration = this.trimVideoPreview.duration;

    if (startPercent > endPercent) {
      if (document.activeElement === this.trimStartRange) {
        this.trimEndRange.value = startPercent;
      } else {
        this.trimStartRange.value = endPercent;
      }
    }

    const startVal = parseFloat(this.trimStartRange.value);
    const endVal = parseFloat(this.trimEndRange.value);

    this.trimRangeFill.style.left = startVal + "%";
    this.trimRangeFill.style.width = endVal - startVal + "%";

    const startTime = (startVal / 100) * duration;
    const endTime = (endVal / 100) * duration;

    this.trimStartTimeInput.value = this.formatSeconds(startTime);
    this.trimEndTimeInput.value = this.formatSeconds(endTime);
    this.trimDurationInfo.textContent = `Duration: ${this.formatSeconds(endTime - startTime)}`;

    // Seek preview to the handle being moved
    if (document.activeElement === this.trimStartRange) {
      this.trimVideoPreview.currentTime = startTime;
    } else if (document.activeElement === this.trimEndRange) {
      this.trimVideoPreview.currentTime = endTime;
    }
  }

  async handleTrimSave() {
    const startSeconds = this.timeToSeconds(this.trimStartTimeInput.value);
    const endSeconds = this.timeToSeconds(this.trimEndTimeInput.value);

    if (startSeconds >= endSeconds) {
      this.showToast("Start time must be before end time", "error");
      return;
    }

    this.saveTrimBtn.disabled = true;
    const saveBtnSpan = this.saveTrimBtn.querySelector("span");
    if (saveBtnSpan) saveBtnSpan.textContent = "Trimming...";

    try {
      const result = await window.electronAPI.trimVideo(
        this.currentTrimPath,
        startSeconds,
        endSeconds,
      );

      if (result.success) {
        this.showToast("Video trimmed successfully", "success");
        this.closeModal(this.trimModal);
        await this.loadRecentRecordings();
      } else {
        this.showToast(`Trimming failed: ${result.error}`, "error");
      }
    } catch (err) {
      console.error("Trim error:", err);
      this.showToast("An error occurred during trimming", "error");
    } finally {
      this.saveTrimBtn.disabled = false;
      if (saveBtnSpan) saveBtnSpan.textContent = "Trim & Save";
    }
  }

  async handleGifSave() {
    const startSeconds = this.timeToSeconds(this.trimStartTimeInput.value);
    const endSeconds = this.timeToSeconds(this.trimEndTimeInput.value);

    if (startSeconds >= endSeconds) {
      this.showToast("Start time must be before end time", "error");
      return;
    }

    const duration = endSeconds - startSeconds;
    if (duration > 30) {
      if (
        !confirm(
          `This GIF will be ${Math.round(duration)} seconds long. GIFs longer than 30s can be very large. Continue?`,
        )
      ) {
        return;
      }
    }

    this.saveGifBtn.disabled = true;
    const gifBtnSpan = this.saveGifBtn.querySelector("span");
    if (gifBtnSpan) gifBtnSpan.textContent = "Exporting GIF...";

    try {
      const result = await window.electronAPI.trimToGif(
        this.currentTrimPath,
        startSeconds,
        endSeconds,
      );

      if (result.success) {
        this.showToast("GIF exported successfully", "success");
        this.closeModal(this.trimModal);
        // Maybe open the folder?
        await window.electronAPI.openFileLocation(result.outputPath);
      } else {
        this.showToast(`GIF export failed: ${result.error}`, "error");
      }
    } catch (err) {
      console.error("GIF export error:", err);
      this.showToast("An error occurred during GIF export", "error");
    } finally {
      this.saveGifBtn.disabled = false;
      if (gifBtnSpan) gifBtnSpan.textContent = "Save as GIF";
    }
  }

  toggleSelectionMode() {
    return this.recentRecordingsManager.toggleSelectionMode();
  }

  async handleMerge() {
    return this.recentRecordingsManager.handleMerge();
  }

  formatSeconds(seconds) {
    return this.timerControls.formatSeconds(seconds);
  }

  timeToSeconds(timeStr) {
    return this.timerControls.timeToSeconds(timeStr);
  }

  // ── Webcam Interaction Logic ───────────────────────────────────────────────

  getVideoContentRect(videoEl) {
    if (!videoEl) return { x: 0, y: 0, width: 0, height: 0 };

    // Fallback if video is not yet loaded or meta not ready
    if (videoEl.videoWidth === 0) {
      const rect = videoEl.getBoundingClientRect();
      const parentRect = this.previewContainer.getBoundingClientRect();
      return {
        x: rect.left - parentRect.left,
        y: rect.top - parentRect.top,
        width: rect.width,
        height: rect.height,
      };
    }

    const containerWidth = videoEl.clientWidth;
    const containerHeight = videoEl.clientHeight;
    const videoWidth = videoEl.videoWidth;
    const videoHeight = videoEl.videoHeight;
    const containerRatio = containerWidth / containerHeight;
    const videoRatio = videoWidth / videoHeight;

    let contentWidth, contentHeight, offsetX, offsetY;

    if (videoRatio > containerRatio) {
      contentWidth = containerWidth;
      contentHeight = containerWidth / videoRatio;
      offsetX = 0;
      offsetY = (containerHeight - contentHeight) / 2;
    } else {
      contentHeight = containerHeight;
      contentWidth = containerHeight * videoRatio;
      offsetY = 0;
      offsetX = (containerWidth - contentWidth) / 2;
    }

    return {
      x: offsetX,
      y: offsetY,
      width: contentWidth,
      height: contentHeight,
    };
  }

  setupWebcamSettingsListeners() {
    this.hotkeyOverlay = document.getElementById("hotkeyOverlay");

    const webcamCheckbox = document.getElementById("settingsWebcam");
    const webcamSizeSelect = document.getElementById("settingsWebcamSize");
    const webcamPosSelect = document.getElementById("settingsWebcamPosition");

    if (webcamCheckbox) {
      webcamCheckbox.addEventListener("change", () => {
        this.settings.webcamEnabled = webcamCheckbox.checked;
        if (webcamCheckbox.checked) {
          this.recordingManager.setupWebcamStream(true);
        } else {
          if (!this.recordingManager.isRecording) {
            this.recordingManager.webcamStream
              ?.getTracks()
              .forEach((t) => t.stop());
            this.recordingManager.webcamStream = null;
          }
        }
        this.applySettings(); // Re-syncs floating window
        this.saveSettings();
      });
    }

    if (webcamSizeSelect) {
      webcamSizeSelect.addEventListener("change", () => {
        this.settings.webcamSize = webcamSizeSelect.value;
        this.applySettings();
        this.saveSettings();
      });
    }

    if (webcamPosSelect) {
      webcamPosSelect.addEventListener("change", () => {
        this.settings.webcamPosition = webcamPosSelect.value;
        // User explicitly picked a preset, clear custom positioning to snap to corner
        delete this.settings.webcamCustomX;
        delete this.settings.webcamCustomY;
        this.updateWebcamHandlePosition();
      });
    }
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
