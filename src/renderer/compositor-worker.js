/**
 * Offscreen Canvas Compositor Worker
 * Handles all canvas drawing operations off-main-thread
 */

let canvas = null;
let ctx = null;
let config = {
  width: 1920,
  height: 1080,
  frameRate: 30,
};

let settings = {
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
    case "updateSettings":
      settings = { ...settings, ...payload };
      break;
    case "renderFrame":
      handleRenderFrame(payload);
      break;
    case "stop":
      canvas = null;
      ctx = null;
      break;
    default:
      console.warn(`Unknown message type: ${type}`);
  }
};

function handleInit(payload) {
  try {
    const { offscreenCanvas, width, height, frameRate, settings: initialSettings } = payload;
    canvas = offscreenCanvas;
    ctx = canvas.getContext("2d");

    // High-performance hint for rendering images at full speed
    ctx.imageSmoothingEnabled = false;

    config.width = width;
    config.height = height;
    config.frameRate = frameRate;

    if (initialSettings) {
      settings = { ...settings, ...initialSettings };
    }

    self.postMessage({ type: "ready" });
  } catch (err) {
    console.error("Compositor worker init failed:", err);
    self.postMessage({ type: "error", error: err.message });
  }
}

let cachedWebcamBitmap = null;
let cachedAnnotationBitmap = null;
let cachedTempAnnotationBitmap = null;

function handleRenderFrame(payload) {
  if (!ctx) return;
  const { screenBitmap, webcamBitmap, annotationBitmap, tempAnnotationBitmap } = payload;

  try {
    // 1. Draw Screen Video Frame (with cropping if needed)
    if (screenBitmap) {
      if (settings.cropRegion) {
        const { x, y, width, height } = settings.cropRegion;
        ctx.drawImage(
          screenBitmap,
          x, y, width, height, // Source rect
          0, 0, config.width, config.height // Dest rect
        );
      } else {
        ctx.drawImage(screenBitmap, 0, 0, config.width, config.height);
      }
      screenBitmap.close();
    } else {
      // Clear to black if no screen bitmap
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, config.width, config.height);
    }

    // 2. Draw Webcam Overlay Frame if enabled
    if (settings.includeWebcam) {
      if (webcamBitmap) {
        if (cachedWebcamBitmap) cachedWebcamBitmap.close();
        cachedWebcamBitmap = webcamBitmap;
      }
      if (cachedWebcamBitmap) {
        drawWebcamOverlay(cachedWebcamBitmap);
      }
    } else {
      if (cachedWebcamBitmap) {
        cachedWebcamBitmap.close();
        cachedWebcamBitmap = null;
      }
      if (webcamBitmap) webcamBitmap.close();
    }

    // 3. Draw Annotation Overlays if enabled
    if (settings.includeAnnotations) {
      if (annotationBitmap) {
        if (cachedAnnotationBitmap) cachedAnnotationBitmap.close();
        cachedAnnotationBitmap = annotationBitmap;
      }
      if (tempAnnotationBitmap) {
        if (cachedTempAnnotationBitmap) cachedTempAnnotationBitmap.close();
        cachedTempAnnotationBitmap = tempAnnotationBitmap;
      }

      const drawCached = (bmp) => {
        if (!bmp) return;
        if (settings.cropRegion) {
          const { x, y, width, height } = settings.cropRegion;
          ctx.drawImage(bmp, x, y, width, height, 0, 0, config.width, config.height);
        } else {
          ctx.drawImage(bmp, 0, 0, config.width, config.height);
        }
      };

      drawCached(cachedAnnotationBitmap);
      drawCached(cachedTempAnnotationBitmap);

    } else {
      if (cachedAnnotationBitmap) {
        cachedAnnotationBitmap.close();
        cachedAnnotationBitmap = null;
      }
      if (cachedTempAnnotationBitmap) {
        cachedTempAnnotationBitmap.close();
        cachedTempAnnotationBitmap = null;
      }
      if (annotationBitmap) annotationBitmap.close();
      if (tempAnnotationBitmap) tempAnnotationBitmap.close();
    }
  } catch (err) {
    console.error("Frame draw error in worker:", err);
  }
}

function drawWebcamOverlay(webcamBitmap) {
  const webcamWidth = webcamBitmap.width;
  const webcamHeight = webcamBitmap.height;
  let webcamX = 0;
  let webcamY = 0;

  const size = settings.webcamSize || "medium";
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
  const position = settings.webcamPosition || "bottom-right";

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
      webcamBitmap,
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
    console.warn("Webcam worker draw error:", err);
  }
}
