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

ipcRenderer.on("presenter-mode", (event, active) => {
    const container = document.querySelector('.camera-container');
    if (active) {
        container.style.borderColor = "#c084fc"; // Lighter purple
        container.style.boxShadow = "0 0 30px rgba(139, 92, 246, 0.8)";
    } else {
        container.style.borderColor = "#8b5cf6";
        container.style.boxShadow = "0 0 20px rgba(0, 0, 0, 0.5)";
    }
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
