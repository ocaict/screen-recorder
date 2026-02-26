const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
    // Tell main process to enable / disable OS-level mouse capture for this window
    setOverlayMouseCapture: (capture) =>
        ipcRenderer.send("overlay-set-mouse-capture", capture),

    // Enable / disable OS-level focusability for typing in input fields
    setOverlayFocusable: (focusable) =>
        ipcRenderer.send("overlay-set-focusable", focusable),

    // Listen for draw-mode toggle from the main renderer
    onOverlayDrawMode: (callback) =>
        ipcRenderer.on("overlay-draw-mode", (_, enabled) => callback(enabled)),

    // Listen for display offset for coordinate conversion
    onOverlayDisplayOffset: (callback) =>
        ipcRenderer.on("overlay-display-offset", (_, offset) => callback(offset)),

    // Listen for tool / color / width changes
    onOverlaySettings: (callback) =>
        ipcRenderer.on("overlay-settings", (_, settings) => callback(settings)),

    // Listen for undo / clear commands
    onOverlayCommand: (callback) =>
        ipcRenderer.on("overlay-command", (_, cmd) => callback(cmd)),

    // Relay mouse actions back to main process (so it can relay to recorder)
    sendOverlayAction: (action) => ipcRenderer.send("overlay-action", action),
});
