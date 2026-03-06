class SettingsHandler {
  constructor(app) {
    this.app = app;
  }

  async loadSettings() {
    try {
      this.app.settings = await window.electronAPI.getSettings();
      this.applySettings();
      this.updateQuickSettings();
      await this.app.recentRecordingsManager.loadRecentRecordings();
    } catch (err) {
      console.error("Failed to load settings:", err);
    }
  }

  applySettings() {
    const s = this.app.settings;
    const getEl = (id) => this.app.document.getElementById(id);
    const setEl = (id, value, isChecked = false) => {
      const el = getEl(id);
      if (el) {
        if (isChecked) el.checked = value;
        else el.value = value;
      }
    };

    setEl("frameRateSelect", s.frameRate);
    setEl("resolutionSelect", s.resolution);
    setEl("countdownSelect", s.countdown);
    setEl("recordAudio", s.recordAudio, true);
    setEl("hwSelect", s.hardwareAcceleration);
  }

  updateQuickSettings() {
    const s = this.app.settings;
    const quickSettings = this.app.quickSettings;
    if (quickSettings) {
      quickSettings.quality = s.videoQuality || "high";
      quickSettings.frameRate = s.frameRate || "24";
      quickSettings.resolution = s.resolution || "1920x1080";
      quickSettings.audioEnabled = s.recordAudio !== false;
      quickSettings.hwAccel = s.hardwareAcceleration || "none";
    }
  }

  showQuickSettings() {
    const qs = this.app.document.getElementById("quickSettingsPanel");
    if (qs) qs.classList.add("active");
  }

  hideQuickSettings() {
    const qs = this.app.document.getElementById("quickSettingsPanel");
    if (qs) qs.classList.remove("active");
  }

  openSettingsModal() {
    const s = this.app.settings;
    const getEl = (id) => this.app.document.getElementById(id);
    const setEl = (id, value, isChecked = false) => {
      const el = getEl(id);
      if (el) {
        if (isChecked) el.checked = value;
        else el.value = value;
      }
    };
    const setElText = (id, value) => {
      const el = getEl(id);
      if (el) el.textContent = value;
    };

    setEl("settingsQuality", s.videoQuality || "high");
    setEl("settingsFrameRate", s.frameRate || "24");
    setEl("settingsResolution", s.resolution || "1920x1080");
    setEl("settingsOutputDir", s.outputDirectory || "");
    setEl("settingsRecordAudio", s.recordAudio !== false, true);
    setEl("settingsCountdown", s.countdown || 3);
    setEl("settingsFilenamePattern", s.filenamePattern || "Recording_{date}_{time}");
    setEl("settingsCompression", s.compression || "balanced");
    setEl("settingsHardwareAcceleration", s.hardwareAcceleration || "none");
    setEl("settingsAutoSave", s.autoSave || false, true);
    setEl("settingsAutoOpen", s.autoOpenAfterRecording !== false, true);

    if (getEl("settingsRecordDirectToMp4")) {
      getEl("settingsRecordDirectToMp4").checked = s.recordDirectToMp4 !== false;
    }

    setEl("settingsHideWindow", s.hideWindowDuringRecording || false, true);
    setEl("settingsShortcut", s.shortcutEnabled !== false, true);
    setEl("settingsShortcutKey", s.shortcutKey || "F9");
    setEl("settingsShowNotifications", s.showNotifications !== false, true);

    if (getEl("settingsShowMiniControls")) {
      getEl("settingsShowMiniControls").checked = s.showMiniControls !== false;
    }
    if (getEl("settingsShowClickHighlights")) {
      getEl("settingsShowClickHighlights").checked = s.showClickHighlights !== false;
    }
    if (getEl("highlightLeftColor")) {
      getEl("highlightLeftColor").value = s.highlightLeftColor || "#FFEB3B";
    }
    if (getEl("highlightRightColor")) {
      getEl("highlightRightColor").value = s.highlightRightColor || "#2196F3";
    }
    if (getEl("highlightRippleSize")) {
      getEl("highlightRippleSize").value = s.highlightRippleSize || 50;
      setElText("rippleSizeValue", s.highlightRippleSize || 50);
    }
    if (getEl("highlightRippleSpeed")) {
      getEl("highlightRippleSpeed").value = s.highlightRippleSpeed || 400;
      setElText("rippleSpeedValue", s.highlightRippleSpeed || 400);
    }
    if (getEl("highlightGlowSize")) {
      getEl("highlightGlowSize").value = s.highlightGlowSize || 25;
      setElText("glowSizeValue", s.highlightGlowSize || 25);
    }
    if (getEl("highlightGlowIntensity")) {
      getEl("highlightGlowIntensity").value = s.highlightGlowIntensity || 30;
      setElText("glowIntensityValue", s.highlightGlowIntensity || 30);
    }
    if (getEl("settingsIdleDetection")) {
      getEl("settingsIdleDetection").checked = s.idleDetectionEnabled || false;
      const idleTimeoutGroup = getEl("idleTimeoutGroup");
      if (idleTimeoutGroup) {
        idleTimeoutGroup.style.display = s.idleDetectionEnabled ? "block" : "none";
      }
    }
    if (getEl("settingsIdleTimeout")) {
      getEl("settingsIdleTimeout").value = s.idleTimeoutMinutes || 5;
    }
    if (getEl("settingsMemoryThreshold")) {
      getEl("settingsMemoryThreshold").value = s.memoryThresholdMB || 500;
    }
    if (getEl("settingsVideoCodec")) {
      getEl("settingsVideoCodec").value = s.videoCodec || "libx264";
    }
    if (getEl("settingsQualityControl")) {
      getEl("settingsQualityControl").value = s.qualityControl || "crf";
    }
    if (getEl("settingsCrfValue")) {
      getEl("settingsCrfValue").value = s.crfValue || 23;
      setElText("crfValueDisplay", s.crfValue || 23);
    }
    if (getEl("settingsVideoBitrate")) {
      getEl("settingsVideoBitrate").value = s.videoBitrate || 5;
      setElText("bitrateValueDisplay", s.videoBitrate || 5);
    }
    if (getEl("settingsColorFormat")) {
      getEl("settingsColorFormat").value = s.colorFormat || "yuv420p";
    }

    this.updateAdvancedSettings();
    this.loadRecordingStats();
    this.updateTimerPresetFromSettings();
    this.loadAudioDevicesForSettings();

    this.app.openModal(this.app.settingsModal);
  }

  updateAdvancedSettings() {
    const hwSelect = this.app.document.getElementById("settingsHardwareAcceleration");
    const advancedGroup = this.app.document.getElementById("advancedSettingsGroup");
    if (hwSelect && advancedGroup) {
      const showAdvanced = ["nvenc", "qsv", "amf", "vaapi"].includes(hwSelect.value);
      advancedGroup.style.display = showAdvanced ? "block" : "none";
    }
  }

  loadRecordingStats() {
    if (this.app.document.getElementById("totalRecordingsCount")) {
      window.electronAPI.getRecordingStats?.().then((stats) => {
        if (stats) {
          this.app.document.getElementById("totalRecordingsCount").textContent = stats.totalRecordings || 0;
          this.app.document.getElementById("totalRecordingTime").textContent = stats.totalDuration || "0s";
          this.app.document.getElementById("totalStorageUsed").textContent = this.app.recentRecordingsManager?.formatFileSize?.(stats.totalSize) || "0 B";
        }
      });
    }
  }

  async updateHardwareAccelerationOptions() {
    try {
      const hwInfo = await window.electronAPI.getHardwareInfo();
      const hwSelect = this.app.document.getElementById("settingsHardwareAcceleration");
      if (!hwSelect) return;

      const options = hwSelect.options;
      for (let i = 0; i < options.length; i++) {
        const opt = options[i];
        if (opt.value === "nvenc") {
          opt.disabled = !hwInfo?.nvenc;
          opt.textContent = hwInfo?.nvenc ? "NVIDIA NVENC" : "NVIDIA NVENC (Not Available)";
        } else if (opt.value === "qsv") {
          opt.disabled = !hwInfo?.qsv;
          opt.textContent = hwInfo?.qsv ? "Intel Quick Sync" : "Intel Quick Sync (Not Available)";
        } else if (opt.value === "amf") {
          opt.disabled = !hwInfo?.amf;
          opt.textContent = hwInfo?.amf ? "AMD AMF" : "AMD AMF (Not Available)";
        }
      }
    } catch (err) {
      console.error("Failed to update HW options:", err);
    }
  }

  async loadAudioDevicesForSettings() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const micSelect = this.app.document.getElementById("settingsMicrophone");
      const sysSelect = this.app.document.getElementById("settingsRecordSystemAudio");

      if (micSelect) {
        micSelect.innerHTML = '<option value="">Default</option>';
        devices.forEach((dev) => {
          if (dev.kind === "audioinput") {
            micSelect.innerHTML += `<option value="${dev.deviceId}" ${this.app.settings.selectedMicrophone === dev.deviceId ? "selected" : ""}>${dev.label || "Microphone"}</option>`;
          }
        });
      }

      if (sysSelect) {
        sysSelect.innerHTML = '<option value="">Default</option>';
        devices.forEach((dev) => {
          if (dev.kind === "audioinput" && !dev.deviceId.startsWith("default-")) {
            sysSelect.innerHTML += `<option value="${dev.deviceId}" ${this.app.settings.selectedSystemAudio === dev.deviceId ? "selected" : ""}>${dev.label || "System Audio"}</option>`;
          }
        });
      }
    } catch (err) {
      console.error("Failed to load audio devices:", err);
    }
  }

  async saveSettings() {
    const getEl = (id) => this.app.document.getElementById(id);

    const shortcutEnabled = getEl("settingsShortcut")?.checked;
    const timerPresetValue = getEl("settingsTimerPreset")?.value;
    const timerPreset = timerPresetValue === "custom"
      ? parseInt(getEl("settingsCustomTimer")?.value) || 45
      : parseInt(timerPresetValue) || 0;

    const newSettings = {
      videoQuality: getEl("settingsQuality")?.value,
      frameRate: parseInt(getEl("settingsFrameRate")?.value),
      resolution: getEl("settingsResolution")?.value,
      outputDirectory: getEl("settingsOutputDir")?.value,
      recordAudio: getEl("settingsRecordAudio")?.checked,
      recordSystemAudio: getEl("settingsRecordSystemAudio")?.checked,
      selectedMicrophone: getEl("settingsMicrophone")?.value,
      hideWindowDuringRecording: getEl("settingsHideWindow")?.checked,
      shortcutEnabled: shortcutEnabled,
      shortcutKey: shortcutEnabled ? getEl("settingsShortcutKey")?.value : this.app.settings.shortcutKey || "F9",
      showNotifications: getEl("settingsShowNotifications")?.checked,
      countdown: parseInt(getEl("settingsCountdown")?.value),
      filenamePattern: getEl("settingsFilenamePattern")?.value,
      compression: getEl("settingsCompression")?.value,
      hardwareAcceleration: getEl("settingsHardwareAcceleration")?.value,
      recordDirectToMp4: getEl("settingsRecordDirectToMp4")?.checked,
      defaultFormat: getEl("settingsFormat")?.value,
      autoSave: getEl("settingsAutoSave")?.checked,
      autoOpenAfterRecording: getEl("settingsAutoOpen")?.checked,
      timerPreset: timerPreset,
      scheduledRecording: getEl("settingsScheduledRecording")?.checked,
      scheduleTime: getEl("settingsScheduleTime")?.value,
      countdownSound: getEl("settingsCountdownSound")?.checked,
      autoHideUI: getEl("settingsAutoHideUI")?.checked,
      webcamEnabled: getEl("settingsWebcam")?.checked,
      selectedCamera: getEl("settingsCamera")?.value || "default",
      webcamPosition: getEl("settingsWebcamPosition")?.value,
      webcamSize: getEl("settingsWebcamSize")?.value,
      videoCodec: getEl("settingsVideoCodec")?.value || "libx264",
      qualityControl: getEl("settingsQualityControl")?.value || "crf",
      crfValue: parseInt(getEl("settingsCrfValue")?.value) || 23,
      videoBitrate: parseInt(getEl("settingsVideoBitrate")?.value) || 5,
      colorFormat: getEl("settingsColorFormat")?.value || "yuv420p",
      showMiniControls: getEl("settingsShowMiniControls")?.checked ?? this.app.settings.showMiniControls !== false,
      showClickHighlights: getEl("settingsShowClickHighlights")?.checked ?? this.app.settings.showClickHighlights !== false,
      highlightLeftColor: getEl("highlightLeftColor")?.value || "#FFEB3B",
      highlightRightColor: getEl("highlightRightColor")?.value || "#2196F3",
      highlightRippleSize: parseInt(getEl("highlightRippleSize")?.value) || 50,
      highlightRippleSpeed: parseInt(getEl("highlightRippleSpeed")?.value) || 400,
      highlightGlowSize: parseInt(getEl("highlightGlowSize")?.value) || 25,
      highlightGlowIntensity: parseInt(getEl("highlightGlowIntensity")?.value) || 30,
      idleDetectionEnabled: getEl("settingsIdleDetection")?.checked || false,
      idleTimeoutMinutes: parseInt(getEl("settingsIdleTimeout")?.value) || 5,
      memoryThresholdMB: parseInt(getEl("settingsMemoryThreshold")?.value) || 500,
    };

    try {
      this.app.settings = await window.electronAPI.saveSettings(newSettings);
      this.applySettings();
      this.updateQuickSettings();
      this.updateTimerPresetFromSettings();
      this.app.closeModal(this.app.settingsModal);
      this.app.showToast("Settings saved", "success");
    } catch (err) {
      this.app.showToast("Failed to save settings", "error");
      console.error(err);
    }
  }

  updateTimerPresetFromSettings() {
    this.app.timerPreset = this.app.settings.timerPreset || 0;
    if (this.app.timerPreset > 0) {
      const presetBtn = this.app.document.querySelector(
        `.timer-preset[data-minutes="${Math.min(this.app.timerPreset, 30)}"]`,
      );
      if (presetBtn) {
        this.app.document.querySelectorAll(".timer-preset").forEach((b) => b.classList.remove("active"));
        presetBtn.classList.add("active");
      }
    }
  }
}
