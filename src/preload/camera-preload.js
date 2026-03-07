const { contextBridge, ipcRenderer } = require("electron");

// Minimal, scoped preload for the floating camera window.
// Replaces the insecure nodeIntegration:true / contextIsolation:false setup.
contextBridge.exposeInMainWorld("cameraAPI", {
    /**
     * Listen for a request to switch the active camera device.
     * @param {(deviceId: string) => void} callback
     */
    onUpdateCamera: (callback) => {
        ipcRenderer.on("update-camera", (_, deviceId) => callback(deviceId));
    },

    /**
     * Listen for presenter-mode activation changes.
     * @param {(active: boolean) => void} callback
     */
    onPresenterMode: (callback) => {
        ipcRenderer.on("presenter-mode", (_, active) => callback(active));
    },

    /**
     * Listen for camera enable/disable commands.
     * @param {(enabled: boolean) => void} callback
     */
    onCameraStatus: (callback) => {
        ipcRenderer.on("camera-status", (_, enabled) => callback(enabled));
    },
});
