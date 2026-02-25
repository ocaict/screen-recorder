/**
 * Offscreen Canvas Compositor Worker
 * Handles all canvas drawing operations off-main-thread
 */

let canvas = null;
let ctx = null;
let isRunning = false;
let frameId = null;
let config = {
  width: 1920,
  height: 1080,
  frameRate: 30,
};

// Video elements and tracks (cloned from main thread)
let screenVideo = null;
let webcamVideo = null;
let annotationCanvas = null;
let tempAnnotationCanvas = null;

// Settings for compositing
let compositorSettings = {
  includeWebcam: false,
  includeAnnotations: false,
  webcamPosition: "bottom-right",
  webcamSize: "medium",
};

self.onmessage = (event) => {
  const { type, payload } = event.data;

  switch (type) {
    case "init":
      handleInit(payload);
      break;
    case "start":
      handleStart();
      break;
    case "stop":
      handleStop();
      break;
    case "updateScreenVideo":
      screenVideo = payload.videoTrack;
      break;
    case "updateWebcamVideo":
      webcamVideo = payload.videoTrack;
      break;
    case "updateAnnotationCanvases":
      annotationCanvas = payload.annotationCanvas;
      tempAnnotationCanvas = payload.tempCanvas;
      break;
    case "updateSettings":
      compositorSettings = { ...compositorSettings, ...payload };
      break;
    case "updateConfig":
      config = { ...config, ...payload };
      break;
    default:
      console.warn(`Unknown message type: ${type}`);
  }
};

function handleInit(payload) {
  try {
    const { offscreenCanvas, width, height, frameRate } = payload;
    canvas = offscreenCanvas;
    ctx = canvas.getContext("2d");
    config.width = width;
    config.height = height;
    config.frameRate = frameRate;
    self.postMessage({ type: "ready" });
  } catch (err) {
    console.error("Compositor worker init failed:", err);
    self.postMessage({ type: "error", error: err.message });
  }
}

function handleStart() {
  if (isRunning) return;
  isRunning = true;

  const drawFrame = () => {
    try {
      if (!isRunning || !ctx) return;

      // Draw screen video
      if (screenVideo && screenVideo.readyState >= 2) {
        ctx.drawImage(screenVideo, 0, 0, config.width, config.height);
      }

      // Draw webcam overlay if enabled
      if (compositorSettings.includeWebcam && webcamVideo) {
        drawWebcamOverlay();
      }

      // Draw annotations if enabled
      if (compositorSettings.includeAnnotations && annotationCanvas) {
        ctx.drawImage(annotationCanvas, 0, 0, config.width, config.height);
        if (tempAnnotationCanvas) {
          ctx.drawImage(
            tempAnnotationCanvas,
            0,
            0,
            config.width,
            config.height,
          );
        }
      }
    } catch (err) {
      console.error("Frame draw error:", err);
    }

    if (isRunning) {
      frameId = requestAnimationFrame(drawFrame);
    }
  };

  drawFrame();
}

function handleStop() {
  isRunning = false;
  if (frameId) {
    cancelAnimationFrame(frameId);
    frameId = null;
  }
}

function drawWebcamOverlay() {
  if (!webcamVideo || webcamVideo.readyState < 2) return;

  const webcamWidth = 320;
  const webcamHeight = 240;
  let webcamX = 0;
  let webcamY = 0;

  const size = compositorSettings.webcamSize || "medium";
  let webcamDisplayWidth;

  switch (size) {
    case "small":
      webcamDisplayWidth = 120;
      break;
    case "large":
      webcamDisplayWidth = 240;
      break;
    default:
      webcamDisplayWidth = 180;
  }

  const webcamDisplayHeight = (webcamHeight / webcamWidth) * webcamDisplayWidth;
  const position = compositorSettings.webcamPosition || "bottom-right";

  switch (position) {
    case "top-left":
      webcamX = 20;
      webcamY = 20;
      break;
    case "top-right":
      webcamX = config.width - webcamDisplayWidth - 20;
      webcamY = 20;
      break;
    case "bottom-left":
      webcamX = 20;
      webcamY = config.height - webcamDisplayHeight - 20;
      break;
    case "bottom-right":
    default:
      webcamX = config.width - webcamDisplayWidth - 20;
      webcamY = config.height - webcamDisplayHeight - 20;
      break;
  }

  try {
    ctx.drawImage(
      webcamVideo,
      webcamX,
      webcamY,
      webcamDisplayWidth,
      webcamDisplayHeight,
    );

    // Draw semi-transparent border/background
    ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
    ctx.beginPath();
    ctx.roundRect(
      webcamX - 2,
      webcamY - 2,
      webcamDisplayWidth + 4,
      webcamDisplayHeight + 4,
      8,
    );
    ctx.fill();
  } catch (err) {
    console.warn("Webcam draw error:", err);
  }
}
