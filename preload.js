const { contextBridge, ipcRenderer, ipcMain } = require("electron");

contextBridge.exposeInMainWorld("api", {
  showFileMenu: (type) => ipcRenderer.invoke("open-file-menu", type),
  minimizeWindow: () => ipcRenderer.invoke("minimize-window"),
  restoreOrMaximizeWindow: () => ipcRenderer.invoke("restore-maximize-window"),
  closeApp: () => ipcRenderer.invoke("close-app"),
});
