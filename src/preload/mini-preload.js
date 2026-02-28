const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
    // Command from Mini Window to Main Process
    sendMiniCommand: (data) => ipcRenderer.send("mini-command", data),

    // Subscription for updates from Main Process
    onRecordingTimerUpdate: (callback) =>
        ipcRenderer.on("mini-timer-update", (_, timeStr) => callback(timeStr)),

    onRecordingStateUpdate: (callback) =>
        ipcRenderer.on("mini-state-update", (_, state) => callback(state)),
});
