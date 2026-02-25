const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  windowMinimize: () => ipcRenderer.invoke("window-minimize"),
  windowMaximize: () => ipcRenderer.invoke("window-maximize"),
  windowClose: () => ipcRenderer.invoke("window-close"),
  windowIsMaximized: () => ipcRenderer.invoke("window-is-maximized"),

  getCaptureSources: () => ipcRenderer.invoke("get-capture-sources"),
  saveRecording: (streamData) =>
    ipcRenderer.invoke("save-recording", streamData),
  openFileLocation: (filePath) =>
    ipcRenderer.invoke("open-file-location", filePath),
  openFile: (filePath) => ipcRenderer.invoke("open-file", filePath),

  setRecordingState: (recording, isPaused = false) =>
    ipcRenderer.invoke("set-recording-state", recording, isPaused),

  getSettings: () => ipcRenderer.invoke("get-settings"),
  saveSettings: (settings) => ipcRenderer.invoke("save-settings", settings),
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

  // Chunked recording API
  startChunkedRecording: (options) =>
    ipcRenderer.invoke("start-chunked-recording", options),
  appendRecordingChunk: (sessionId, arrayBuffer) =>
    ipcRenderer.send("append-recording-chunk", sessionId, arrayBuffer),
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
});
