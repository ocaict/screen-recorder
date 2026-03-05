const { ipcRenderer } = require("electron");
const cameraVideo = document.getElementById('cameraVideo');
let currentStream = null;

async function startCamera(deviceId = "default") {
    try {
        if (currentStream) {
            currentStream.getTracks().forEach(t => t.stop());
        }

        const constraints = {
            video: {
                width: { ideal: 640 },
                height: { ideal: 640 },
                frameRate: { ideal: 30 }
            },
            audio: false
        };

        if (deviceId && deviceId !== "default") {
            constraints.video.deviceId = { exact: deviceId };
        }

        currentStream = await navigator.mediaDevices.getUserMedia(constraints);
        cameraVideo.srcObject = currentStream;

    } catch (err) {
        console.error('Failed to start floating camera:', err);
    }
}

// Listen for updates from the main process
ipcRenderer.on("update-camera", (event, deviceId) => {
    startCamera(deviceId);
});

ipcRenderer.on("camera-status", (event, enabled) => {
    if (!enabled && currentStream) {
        currentStream.getTracks().forEach(t => t.stop());
        currentStream = null;
        cameraVideo.srcObject = null;
    } else if (enabled && !currentStream) {
        startCamera();
    }
});

// Start the default camera initially
startCamera();
