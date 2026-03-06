const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
    // Command from Mini Window to Main Process
    sendMiniCommand: (data) => ipcRenderer.send("mini-command", data),

    // Subscription for updates from Main Process
    onRecordingTimerUpdate: (callback) =>
        ipcRenderer.on("mini-timer-update", (_, timeStr) => callback(timeStr)),

    onRecordingStateUpdate: (callback) =>
        ipcRenderer.on("mini-state-update", (_, state) => callback(state)),
    onRecordingVolumeUpdate: (callback) =>
        ipcRenderer.on("mini-volume-update", (_, volume) => callback(volume)),

    // Drag support
    getMiniWindowPosition: () => ipcRenderer.sendSync("get-mini-window-position"),
    moveMiniWindow: (x, y) => ipcRenderer.send("move-mini-window", x, y),
});

