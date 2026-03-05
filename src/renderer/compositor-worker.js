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
  cameraMode: "corner", // "corner" or "center"
  displayWidth: null,   // Display dimensions for presenter mode calculation
  displayHeight: null
};

// Animation state
let animProgress = 0; // 0 = corner, 1 = center
let lastFrameTime = performance.now();

self.onmessage = (event) => {
  const { type, payload } = event.data;

  switch (type) {
    case "init":
      handleInit(payload);
      break;
    case "updateSettings":
      // Merge and explicitly delete any keys set to undefined
      Object.entries(payload).forEach(([k, v]) => {
        if (v === undefined) {
          delete settings[k];
        } else {
          settings[k] = v;
        }
      });
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

    // DIM Background if animating to Presentation Mode
    if (animProgress > 0) {
      // Background dims up to 80% opacity when in Full Camera mode
      ctx.fillStyle = `rgba(0, 0, 0, ${animProgress * 0.8})`;
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
  const now = performance.now();
  const dt = Math.min(now - lastFrameTime, 100) / 1000; // Delta time in seconds (capped to 100ms)
  lastFrameTime = now;

  // Update animation progress
  const targetProgress = settings.cameraMode === "center" ? 1 : 0;
  if (animProgress !== targetProgress) {
    // Animate over ~0.4 seconds
    const speed = 2.5;
    if (targetProgress === 1) {
      animProgress = Math.min(1, animProgress + speed * dt);
    } else {
      animProgress = Math.max(0, animProgress - speed * dt);
    }
    // Easing function (easeOutCirc) for a snappy but smooth POP effect
    // We'll apply it later when calculating actual values to keep internal state linear
  }

  const webcamWidth = webcamBitmap.width;
  const webcamHeight = webcamBitmap.height;
  let targetX = 0;
  let targetY = 0;

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
    targetX = Math.round(settings.webcamCustomX * (config.width - webcamDisplayWidth));
    targetY = Math.round(settings.webcamCustomY * (config.height - webcamDisplayHeight));
  } else {
    switch (position) {
      case "top-left":
        targetX = 20;
        targetY = 20;
        break;
      case "top-right":
        targetX = config.width - webcamDisplayWidth - 20;
        targetY = 20;
        break;
      case "bottom-left":
        targetX = 20;
        targetY = config.height - webcamDisplayHeight - 20;
        break;
      case "bottom-right":
      default:
        targetX = config.width - webcamDisplayWidth - 20;
        targetY = config.height - webcamDisplayHeight - 20;
        break;
    }
  }

  // Calculate actual position and size using interpolation
  // Apply easeInOutCubic for a cinematic sweep
  const ease = animProgress < 0.5 ? 4 * animProgress * animProgress * animProgress : 1 - Math.pow(-2 * animProgress + 2, 3) / 2;

  // Center values - use display dimensions if available (presenter mode), otherwise canvas
  const centerRefWidth = settings.displayWidth || config.width;
  const centerRefHeight = settings.displayHeight || config.height;
  const centerDisplayWidth = Math.min(centerRefWidth, centerRefHeight) * 0.45; // Match native window calculation
  const centerX = (config.width - centerDisplayWidth) / 2;
  const centerY = (config.height - centerDisplayWidth) / 2;

  // Lerp between corner (0) and center (1)
  const currentWidth = webcamDisplayWidth + ((centerDisplayWidth - webcamDisplayWidth) * ease);
  const currentX = targetX + ((centerX - targetX) * ease);
  const currentY = targetY + ((centerY - targetY) * ease);

  try {
    const cx = currentX + currentWidth / 2;
    const cy = currentY + currentWidth / 2;
    const radius = currentWidth / 2;

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
