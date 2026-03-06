const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
    // Commands from Palette to Main/Overlay
    sendAnnotationPaletteCommand: (data) => ipcRenderer.send("annotation-palette-command", data),

    // Updates from Main/Overlay
    onAnnotationSettings: (callback) => ipcRenderer.on("annotation-settings-update", (_, settings) => callback(settings)),

    // Window movement
    movePalette: (x, y) => ipcRenderer.send("move-palette-window", x, y),
    getPalettePosition: () => ipcRenderer.sendSync("get-palette-window-position"),
});
