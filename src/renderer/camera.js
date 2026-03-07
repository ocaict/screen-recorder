// camera.js — Floating camera window renderer
// Uses window.cameraAPI (injected by camera-preload.js) instead of
// direct ipcRenderer access. contextIsolation is now ON for this window.

const cameraVideo = document.getElementById('cameraVideo');
let currentStream = null;

async function startCamera(deviceId = "default") {
    try {
        if (currentStream) {
            currentStream.getTracks().forEach(t => t.stop());
            currentStream = null;
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

// Listen for updates from the main process (via secure preload bridge)
window.cameraAPI.onUpdateCamera((deviceId) => {
    startCamera(deviceId);
});

window.cameraAPI.onPresenterMode((active) => {
    const container = document.querySelector('.camera-container');
    if (!container) return;
    if (active) {
        container.style.borderColor = "#c084fc"; // Lighter purple
        container.style.boxShadow = "0 0 30px rgba(139, 92, 246, 0.8)";
    } else {
        container.style.borderColor = "#8b5cf6";
        container.style.boxShadow = "0 0 20px rgba(0, 0, 0, 0.5)";
    }
});

window.cameraAPI.onCameraStatus((enabled) => {
    if (!enabled && currentStream) {
        currentStream.getTracks().forEach(t => t.stop());
        currentStream = null;
        cameraVideo.srcObject = null;
    } else if (enabled && !currentStream) {
        startCamera();
    }
});

// Start the default camera on load
startCamera();
