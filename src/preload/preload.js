const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  windowMinimize: () => ipcRenderer.invoke("window-minimize"),
  windowMaximize: () => ipcRenderer.invoke("window-maximize"),
  windowClose: () => ipcRenderer.invoke("window-close"),
  windowIsMaximized: () => ipcRenderer.invoke("window-is-maximized"),

  getCaptureSources: () => ipcRenderer.invoke("get-capture-sources"),
  saveRecording: (streamData, chunkFiles, options) =>
    ipcRenderer.invoke("save-recording", streamData, chunkFiles, options),
  openFileLocation: (filePath) =>
    ipcRenderer.invoke("open-file-location", filePath),
  openFile: (filePath) => ipcRenderer.invoke("open-file", filePath),
  trimVideo: (filePath, startTime, endTime) =>
    ipcRenderer.invoke("trim-video", filePath, startTime, endTime),
  trimToGif: (filePath, startTime, endTime) =>
    ipcRenderer.invoke("trim-to-gif", filePath, startTime, endTime),
  mergeVideos: (filePaths) => ipcRenderer.invoke("merge-videos", filePaths),

  getSettings: () => ipcRenderer.invoke("get-settings"),
  saveSettings: (settings) => ipcRenderer.invoke("save-settings", settings),
  resetSettings: () => ipcRenderer.invoke("reset-settings"),
  getRecentRecordings: () => ipcRenderer.invoke("get-recent-recordings"),
  addRecentRecording: (filePath) =>
    ipcRenderer.invoke("add-recent-recording", filePath),
  removeRecentRecording: (filePath) =>
    ipcRenderer.invoke("remove-recent-recording", filePath),
  clearRecentRecordings: () => ipcRenderer.invoke("clear-recent-recordings"),
  removeRecentRecordingAndFile: (filePath) =>
    ipcRenderer.invoke("remove-recent-recording-and-file", filePath),

  showSaveDialog: (options) => ipcRenderer.invoke("show-save-dialog", options),
  selectDirectory: () => ipcRenderer.invoke("select-directory"),
  getAppPaths: () => ipcRenderer.invoke("get-app-paths"),
  getAvailableEncoders: () => ipcRenderer.invoke("get-available-encoders"),
  getDisplays: () => ipcRenderer.invoke("get-displays"),
  startRegionSelection: () => ipcRenderer.invoke("start-region-selection"),
  sendRegionSelected: (region) => ipcRenderer.send("region-selected", region),
  sendRegionCancelled: () => ipcRenderer.send("region-cancelled"),
  onRegionInit: (callback) =>
    ipcRenderer.on("region-init", (_, data) => callback(data)),
  onWindowsUpdate: (callback) =>
    ipcRenderer.on("windows-update", (_, windows) => callback(windows)),

  // Visual Region Indicator during recording
  showRegionIndicator: (region) => ipcRenderer.send("region-indicator-show", region),
  hideRegionIndicator: () => ipcRenderer.send("region-indicator-hide"),
  onRegionUpdate: (callback) =>
    ipcRenderer.on("region-update", (_, region) => callback(region)),
  onInit: (callback) =>
    ipcRenderer.on("region-init", (_, data) => callback(data)),

  // Chunked recording API
  startChunkedRecording: (options) =>
    ipcRenderer.invoke("start-chunked-recording", options),
  appendRecordingChunk: (sessionId, chunkData) =>
    ipcRenderer.send("append-recording-chunk", sessionId, chunkData),
  finalizeChunkedRecording: (sessionId, options) =>
    ipcRenderer.invoke("finalize-chunked-recording", sessionId, options),
  abortChunkedRecording: (sessionId) =>
    ipcRenderer.invoke("abort-chunked-recording", sessionId),

  onStopRecordingFromTray: (callback) => {
    ipcRenderer.on("stop-recording-from-tray", () => callback());
  },

  onStopRecordingFromShortcut: (callback) => {
    ipcRenderer.on("stop-recording-from-shortcut", () => callback());
  },

  onResumeRecordingFromTray: (callback) => {
    ipcRenderer.on("resume-recording-from-tray", () => callback());
  },

  onPauseRecordingFromTray: (callback) => {
    ipcRenderer.on("pause-recording-from-tray", () => callback());
  },

  onConversionStarted: (callback) => {
    ipcRenderer.on("conversion-started", () => callback());
  },

  onConversionProgress: (callback) => {
    ipcRenderer.on("conversion-progress", (_, progress) => callback(progress));
  },

  onConversionComplete: (callback) => {
    ipcRenderer.on("conversion-complete", (_, filePath) => callback(filePath));
  },

  onStopRecordingFromQuit: (callback) => {
    ipcRenderer.on("stop-recording-from-quit", () => callback());
  },

  onError: (callback) => {
    ipcRenderer.on("error-message", (_, error) => callback(error));
  },

  removeAllListeners: (channel) => {
    ipcRenderer.removeAllListeners(channel);
  },

  // ── Overlay annotation window control ──────────────────────────────────────
  showOverlay: (displayId) => ipcRenderer.invoke("overlay-show", displayId),
  hideOverlay: () => ipcRenderer.invoke("overlay-hide"),

  // Enable / disable draw mode (makes overlay capture mouse events)
  setOverlayDrawMode: (enabled) => ipcRenderer.send("overlay-draw-mode", enabled),

  // Push tool / color / strokeWidth changes into the overlay
  sendOverlaySettings: (settings) =>
    ipcRenderer.send("overlay-settings-from-main", settings),

  // Trigger undo or clear inside the overlay
  sendOverlayCommand: (cmd) =>
    ipcRenderer.send("overlay-command-from-main", cmd),

  // Receive relayed mouse actions from the overlay (for the compositor)
  onOverlayAction: (callback) =>
    ipcRenderer.on("overlay-action", (_, action) => callback(action)),

  onSettingsUpdated: (callback) =>
    ipcRenderer.on("settings-updated", (_, settings) => callback(settings)),

  // Mini Controls Sync
  sendRecordingTimerUpdate: (timeStr) =>
    ipcRenderer.send("recording-timer-update", timeStr),

  onMiniCommand: (callback) =>
    ipcRenderer.on("mini-command", (_, data) => callback(data)),
  onWindowMinimized: (callback) => ipcRenderer.on("window-minimized", () => callback()),
  onWindowRestored: (callback) => ipcRenderer.on("window-restored", () => callback()),
  onPresenterModeDisplay: (callback) =>
    ipcRenderer.on("presenter-mode-display", (_, dims) => callback(dims)),

  // Floating Camera Window
  toggleCameraWindow: (show) => ipcRenderer.invoke("camera-window-toggle", show),
  updateCameraSettings: (settings) => ipcRenderer.invoke("update-camera-settings", settings),
  getCameraWindowBounds: () => ipcRenderer.invoke("get-camera-window-bounds"),
  setRecordingState: (recording, isPaused = false) =>
    ipcRenderer.invoke("set-recording-state", recording, isPaused),
});

