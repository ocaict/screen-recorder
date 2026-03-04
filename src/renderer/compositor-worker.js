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

  // Use proportional sizing based on canvas width (normalized to a 1920px baseline)
  switch (size) {
    case "small":
      webcamDisplayWidth = config.width * 0.0625; // 120/1920
      break;
    case "large":
      webcamDisplayWidth = config.width * 0.125;  // 240/1920
      break;
    default:
      webcamDisplayWidth = config.width * 0.09375; // 180/1920
  }

  const webcamDisplayHeight = webcamDisplayWidth; // Perfect circle
  const position = settings.webcamPosition || "bottom-right";

  // If the user has dragged to a custom position, use it (normalized 0-1 coords)
  if (settings.webcamCustomX !== undefined && settings.webcamCustomY !== undefined) {
    // Map normalized coordinates (0-1) to the actual available movement range
    webcamX = Math.round(settings.webcamCustomX * (config.width - webcamDisplayWidth));
    webcamY = Math.round(settings.webcamCustomY * (config.height - webcamDisplayHeight));
  } else {
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
  }

  try {
    const cx = webcamX + webcamDisplayWidth / 2;
    const cy = webcamY + webcamDisplayHeight / 2;
    const radius = webcamDisplayWidth / 2;

    ctx.save();

    // Draw outer white rim and drop shadow
    ctx.shadowColor = "rgba(0, 0, 0, 0.45)";
    ctx.shadowBlur = 15;
    ctx.shadowOffsetY = 5;
    // Remove shadow offset on x for symmetrical look
    ctx.shadowOffsetX = 0;

    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();

    // Reset shadow internally so it doesn't leak into the video image
    ctx.shadowColor = "transparent";

    // Setup circular clip path for the video
    ctx.beginPath();
    // 3px inset to create the white border ring
    ctx.arc(cx, cy, Math.max(0, radius - 3), 0, Math.PI * 2);
    ctx.clip();

    // Source coordinates for a center-square crop of the raw webcam feed
    const srcSize = Math.min(webcamWidth, webcamHeight);
    const srcX = (webcamWidth - srcSize) / 2;
    const srcY = (webcamHeight - srcSize) / 2;

    ctx.drawImage(
      webcamBitmap,
      srcX, srcY, srcSize, srcSize, // Source crop
      cx - radius, cy - radius, radius * 2, radius * 2 // Destination
    );

    ctx.restore();
  } catch (err) {
    console.warn("Webcam worker draw error:", err);
  }
}
