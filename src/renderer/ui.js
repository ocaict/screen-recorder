class UIManager {
  constructor(app) {
    this.app = app;
  }

  initializeElements() {
    this.app.previewVideo = document.getElementById("previewVideo");
    this.app.noSourceMessage = document.getElementById("noSourceMessage");
    this.app.recordingIndicator = document.getElementById("recordingIndicator");
    this.app.recordingTime = document.getElementById("recordingTime");
    this.app.selectSourceBtn = document.getElementById("selectSourceBtn");
    this.app.startBtn = document.getElementById("startBtn");
    this.app.pauseBtn = document.getElementById("pauseBtn");
    this.app.pauseIcon = document.getElementById("pauseIcon");
    this.app.resumeIcon = document.getElementById("resumeIcon");
    this.app.pauseBtnText = document.getElementById("pauseBtnText");
    this.app.stopBtn = document.getElementById("stopBtn");
    this.app.discardBtn = document.getElementById("discardBtn");
    this.app.annotationToggleBtn = document.getElementById("annotationToggleBtn");
    this.app.sourceModal = document.getElementById("sourceModal");
    this.app.sourceGrid = document.getElementById("sourceGrid");
    this.app.closeSourceModal = document.getElementById("closeSourceModal");
    this.app.settingsModal = document.getElementById("settingsModal");
    this.app.closeSettingsModal = document.getElementById("closeSettingsModal");
    this.app.settingsBtn = document.getElementById("settingsBtn");
    this.app.saveSettingsBtn = document.getElementById("saveSettingsBtn");
    this.app.resetSettingsBtn = document.getElementById("resetSettingsBtn");
    this.app.toastContainer = document.getElementById("toastContainer");
    this.app.processingOverlay = document.getElementById("processingOverlay");
    this.app.progressFill = document.getElementById("progressFill");
    this.app.progressPercent = document.getElementById("progressPercent");
    this.app.processingTitle = document.getElementById("processingTitle");
    this.app.processingStatus = document.getElementById("processingStatus");
    this.app.progressEta = document.getElementById("progressEta");
    this.app.processingCancel = document.getElementById("processingCancel");
    this.app.sourceList = document.getElementById("sourceList");
    this.app.minimizeBtn = document.getElementById("minimizeBtn");
    this.app.maximizeBtn = document.getElementById("maximizeBtn");
    this.app.closeBtn = document.getElementById("closeBtn");
    this.app.countdownOverlay = document.getElementById("countdownOverlay");
    this.app.countdownNumber = document.getElementById("countdownNumber");
    this.app.recentRecordingsList = document.getElementById("recentRecordingsList");
    this.app.clearRecentBtn = document.getElementById("clearRecentBtn");
    this.app.hotkeyOverlay = document.getElementById("hotkeyOverlay");
    this.app.hotkeyKey = document.getElementById("hotkeyKey");
    this.app.toggleSelectBtn = document.getElementById("toggleSelectBtn");
    this.app.mergeRecordingsBtn = document.getElementById("mergeRecordingsBtn");
    this.app.hwInfo = document.getElementById("hardwareInfo");
    this.app.hwAutoBtn = document.getElementById("autoSelectNvenc");
    this.app.nvencPrompt = document.getElementById("nvencPrompt");
    this.app.nvencEnableBtn = document.getElementById("nvencEnableBtn");
    this.app.nvencDismissBtn = document.getElementById("nvencDismissBtn");
    this.app.fileSizePreview = document.getElementById("fileSizePreview");
    this.app.recordingPill = document.getElementById("recordingPill");
    this.app.pillTime = document.getElementById("pillTime");
    this.app.emptySourceBtn = document.getElementById("emptySourceBtn");
    this.app.quickSettings = document.getElementById("quickSettings");
    this.app.quickResolution = document.getElementById("quickResolution")?.querySelector("span");
    this.app.quickFps = document.getElementById("quickFps")?.querySelector("span");
    this.app.quickQuality = document.getElementById("quickQuality")?.querySelector("span");
    this.app.recordingStats = document.getElementById("recordingStats");
    this.app.statFps = document.getElementById("statFps");
    this.app.statSize = document.getElementById("statSize");
    this.app.statRes = document.getElementById("statRes");
    this.app.audioMeter = document.getElementById("audioMeter");
    this.app.audioMeterBars = document.getElementById("audioMeterBars");
    this.app.processingStartTime = null;
    this.app.isProcessingCancelled = false;
    this.app.timerPreset = 0;
    this.app.recordingTimeout = null;
    this.app.shortcutsModal = document.getElementById("shortcutsModal");
    this.app.closeShortcutsModal = document.getElementById("closeShortcutsModal");
    this.app.showShortcutsBtn = document.getElementById("showShortcutsBtn");
    this.app.settingsTimerPreset = document.getElementById("settingsTimerPreset");
    this.app.settingsCustomTimer = document.getElementById("settingsCustomTimer");
    this.app.customTimerGroup = document.getElementById("customTimerGroup");
    this.app.settingsScheduledRecording = document.getElementById("settingsScheduledRecording");
    this.app.scheduleTimeGroup = document.getElementById("scheduleTimeGroup");
    this.app.settingsScheduleTime = document.getElementById("settingsScheduleTime");
    this.app.totalRecordingsEl = document.getElementById("totalRecordings");
    this.app.totalDurationEl = document.getElementById("totalDuration");
    this.app.totalStorageEl = document.getElementById("totalStorage");

    // Trim Modal Elements
    this.app.trimModal = document.getElementById("trimModal");
    this.app.closeTrimModal = document.getElementById("closeTrimModal");
    this.app.trimVideoPreview = document.getElementById("trimVideoPreview");
    this.app.trimStartRange = document.getElementById("trimStartRange");
    this.app.trimEndRange = document.getElementById("trimEndRange");
    this.app.trimStartTimeInput = document.getElementById("trimStartTime");
    this.app.trimEndTimeInput = document.getElementById("trimEndTime");
    this.app.trimDurationInfo = document.getElementById("trimDurationInfo");
    this.app.trimRangeFill = document.getElementById("trimRangeFill");
    this.app.saveTrimBtn = document.getElementById("saveTrimBtn");
    this.app.saveGifBtn = document.getElementById("saveGifBtn");
    this.app.cancelTrimBtn = document.getElementById("cancelTrimBtn");

    // Webcam Drag
    this.app.webcamDragHandle = document.getElementById("webcamDragHandle");
    this.app.webcamPreviewVideo = document.getElementById("webcamPreviewVideo");
    this.app.previewContainer = document.querySelector(".preview-container");
  }

  showToast(message, type = "info") {
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.textContent = message;

    this.app.toastContainer.appendChild(toast);

    setTimeout(() => toast.remove(), 4000);
  }

  closeModal(modal) {
    modal.classList.remove("active");
    modal.removeAttribute("aria-modal");
    modal.removeAttribute("role");
  }

  openModal(modal) {
    modal.classList.add("active");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("role", "dialog");
    const focusable = modal.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (focusable) {
      setTimeout(() => focusable.focus(), 100);
    }
  }

  trapFocus(e, modal) {
    const focusableElements = modal.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    if (e.shiftKey && document.activeElement === firstElement) {
      e.preventDefault();
      lastElement.focus();
    } else if (!e.shiftKey && document.activeElement === lastElement) {
      e.preventDefault();
      firstElement.focus();
    }
  }

  formatFileSize(bytes) {
    if (!bytes || bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  }

  runCountdown(seconds) {
    return new Promise((resolve) => {
      this.app.countdownOverlay.classList.remove("hidden");
      this.app.countdownNumber.textContent = seconds;

      let remaining = seconds;
      let cancelled = false;

      const originalStopRecording = this.app.recordingManager.stopRecording.bind(this.app.recordingManager);

      const countdownInterval = setInterval(() => {
        remaining--;

        if (remaining <= 0) {
          clearInterval(countdownInterval);
          this.app.countdownOverlay.classList.add("hidden");
          this.app.recordingManager.stopRecording = originalStopRecording;
          resolve(false);
        } else {
          this.app.countdownNumber.textContent = remaining;
        }
      }, 1000);

      this.app.recordingManager._countdownCancelled = false;

      this.app.recordingManager.stopRecording = () => {
        cancelled = true;
        clearInterval(countdownInterval);
        this.app.countdownOverlay.classList.add("hidden");
        this.app.recordingManager._countdownCancelled = true;
        this.app.recordingManager.stopRecording = originalStopRecording;
        this.app.showToast("Countdown cancelled", "info");
        this.app.startBtn.disabled = false;
        this.app.selectSourceBtn.disabled = false;
        this.app.startBtn.textContent = "Start Recording";
      };
    }).then((cancelled) => {
      return cancelled;
    });
  }
}

window.UIManager = UIManager;
