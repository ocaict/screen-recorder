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

// Frame Buffers
let latestScreenFrame = null;
let latestWebcamFrame = null;
let latestAnnotationBitmap = null;
let latestTempAnnotationBitmap = null;
let latestWatermarkBitmap = null;

// Animation state
let animProgress = 0; // 0 = corner, 1 = center
let lastFrameTime = performance.now();
let isRunning = false;

self.onmessage = (event) => {
  const { type, payload } = event.data;

  switch (type) {
    case "init":
      handleInit(payload);
      break;
    case "initStreams":
      if (payload.screenStream) startStreamReader("screen", payload.screenStream);
      if (payload.webcamStream) startStreamReader("webcam", payload.webcamStream);
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
      // Now primarily used for Annotations (Sparse updates)
      if (payload.annotationBitmap) {
        if (latestAnnotationBitmap) latestAnnotationBitmap.close();
        latestAnnotationBitmap = payload.annotationBitmap;
      }
      if (payload.tempAnnotationBitmap) {
        if (latestTempAnnotationBitmap) latestTempAnnotationBitmap.close();
        latestTempAnnotationBitmap = payload.tempAnnotationBitmap;
      }
      break;
    case "updateWatermark":
      if (payload.watermarkBitmap) {
        if (latestWatermarkBitmap) latestWatermarkBitmap.close();
        latestWatermarkBitmap = payload.watermarkBitmap;
      }
      break;
    case "stop":
      isRunning = false;
      cleanup();
      break;
    default:
      console.warn(`Unknown message type: ${type}`);
  }
};

async function startStreamReader(type, stream) {
  const reader = stream.getReader();
  while (isRunning) {
    try {
      const { value: frame, done } = await reader.read();
      if (done) break;
      
      if (type === "screen") {
        if (latestScreenFrame) latestScreenFrame.close();
        latestScreenFrame = frame;
      } else if (type === "webcam") {
        if (latestWebcamFrame) latestWebcamFrame.close();
        latestWebcamFrame = frame;
      }
    } catch (e) {
      console.error(`Worker stream reader error (${type}):`, e);
      break;
    }
  }
}

function handleInit(payload) {
  try {
    const { offscreenCanvas, width, height, frameRate, settings: initialSettings } = payload;
    canvas = offscreenCanvas;
    ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });

    // Enable smoothing for better quality scale/rotation
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    config.width = width;
    config.height = height;
    config.frameRate = frameRate;

    if (initialSettings) {
      settings = { ...settings, ...initialSettings };
    }

    isRunning = true;
    requestAnimationFrame(compositionLoop);
    self.postMessage({ type: "ready" });
  } catch (err) {
    console.error("Compositor worker init failed:", err);
    self.postMessage({ type: "error", error: err.message });
  }
}

function compositionLoop(timestamp) {
  if (!isRunning) return;

  renderEverything();
  
  // Heartbeat back to main thread for stats/monitoring
  self.postMessage({ type: "frameRendered" });
  
  requestAnimationFrame(compositionLoop);
}

function renderEverything() {
  if (!ctx) return;

  try {
    // 1. Draw Screen (Background)
    if (latestScreenFrame) {
      if (settings.cropRegion) {
        const { x, y, width, height } = settings.cropRegion;
        ctx.drawImage(latestScreenFrame, x, y, width, height, 0, 0, config.width, config.height);
      } else {
        ctx.drawImage(latestScreenFrame, 0, 0, config.width, config.height);
      }
    } else {
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, config.width, config.height);
    }

    // DIM Background if in Presentation Mode
    if (animProgress > 0) {
      ctx.fillStyle = `rgba(0, 0, 0, ${animProgress * 0.8})`;
      ctx.fillRect(0, 0, config.width, config.height);
    }

    // 2. Draw Webcam Overlay
    if (settings.includeWebcam && latestWebcamFrame) {
      drawWebcamOverlay(latestWebcamFrame);
    }

    // 3. Draw Annotations
    if (settings.includeAnnotations) {
      const drawLayer = (bmp) => {
        if (!bmp) return;
        if (settings.cropRegion) {
          const { x, y, width, height } = settings.cropRegion;
          ctx.drawImage(bmp, x, y, width, height, 0, 0, config.width, config.height);
        } else {
          ctx.drawImage(bmp, 0, 0, config.width, config.height);
        }
      };
      drawLayer(latestAnnotationBitmap);
      drawLayer(latestTempAnnotationBitmap);
    }

    // 4. Draw Watermark (Top Layer)
    if (settings.watermarkEnabled) {
      drawWatermark();
    }
  } catch (err) {
    console.error("Worker Render Error:", err);
  }
}

function drawWatermark() {
  ctx.save();
  
  // Ensure we have reasonable defaults for calculations
  const opacity = (settings.watermarkOpacity === undefined) ? 0.5 : settings.watermarkOpacity;
  const sizeScale = (settings.watermarkSize || 15) / 100;
  const watermarkType = settings.watermarkType || 'text';
  const watermarkText = settings.watermarkText || "OcaTech-Recorder";
  
  ctx.globalAlpha = opacity;

  let x, y;
  const margin = Math.max(10, Math.round(config.width * 0.02)); // Adaptive margin
  const targetWidth = config.width * sizeScale;

  // Calculate size based on type
  let contentWidth = 0, contentHeight = 0;
  let useTextFallback = false;

  if (watermarkType === 'image' && latestWatermarkBitmap) {
    const ratio = latestWatermarkBitmap.width / latestWatermarkBitmap.height;
    contentWidth = targetWidth;
    contentHeight = targetWidth / ratio;
  } else {
    // Use text if type is 'text' OR if image type requested but no bitmap available
    useTextFallback = true;
    const fontSize = Math.max(12, Math.round(config.width * 0.025 * ((settings.watermarkSize || 15) / 15)));
    ctx.font = `bold ${fontSize}px sans-serif`;
    const metrics = ctx.measureText(watermarkText);
    contentWidth = metrics.width;
    contentHeight = fontSize;
  }

  if (contentWidth === 0) { ctx.restore(); return; }

  // Positioning
  const pos = settings.watermarkPosition || "bottom-right";
  ctx.textBaseline = "top"; // Use top baseline for easier math

  switch (pos) {
    case "top-left": x = margin; y = margin; break;
    case "top-center": x = (config.width - contentWidth) / 2; y = margin; break;
    case "top-right": x = config.width - contentWidth - margin; y = margin; break;
    case "center-left": x = margin; y = (config.height - contentHeight) / 2; break;
    case "center": x = (config.width - contentWidth) / 2; y = (config.height - contentHeight) / 2; break;
    case "center-right": x = config.width - contentWidth - margin; y = (config.height - contentHeight) / 2; break;
    case "bottom-left": x = margin; y = config.height - margin - contentHeight; break;
    case "bottom-center": x = (config.width - contentWidth) / 2; y = config.height - margin - contentHeight; break;
    default: // bottom-right
      x = config.width - contentWidth - margin; y = config.height - margin - contentHeight;
  }

  if (!useTextFallback && latestWatermarkBitmap) {
    ctx.drawImage(latestWatermarkBitmap, x, y, contentWidth, contentHeight);
  } else {
    // Text rendering with robust shadow and backup color
    ctx.shadowColor = "rgba(0, 0, 0, 0.8)";
    ctx.shadowBlur = 4;
    ctx.shadowOffsetX = 1;
    ctx.shadowOffsetY = 1;
    ctx.fillStyle = "white";
    ctx.fillText(watermarkText, x, y);
    
    // Debug log only once if it's the fallback
    if (watermarkType === 'image' && !self.fallbackLogged) {
      console.warn("[Worker] Image watermark bitmap missing, falling back to text.");
      self.fallbackLogged = true;
    }
  }

  ctx.restore();
}

function drawWebcamOverlay(webcamFrame) {
  const now = performance.now();
  const dt = Math.min(now - lastFrameTime, 100) / 1000;
  lastFrameTime = now;

  const targetProgress = settings.cameraMode === "center" ? 1 : 0;
  if (animProgress !== targetProgress) {
    const speed = 2.5;
    if (targetProgress === 1) animProgress = Math.min(1, animProgress + speed * dt);
    else animProgress = Math.max(0, animProgress - speed * dt);
  }

  const ease = animProgress < 0.5 ? 4 * animProgress * animProgress * animProgress : 1 - Math.pow(-2 * animProgress + 2, 3) / 2;

  let webcamDisplayWidth;
  switch (settings.webcamSize) {
    case "small": webcamDisplayWidth = config.width * 0.0625; break;
    case "large": webcamDisplayWidth = config.width * 0.125; break;
    default: webcamDisplayWidth = config.width * 0.09375;
  }

  const webcamDisplayHeight = webcamDisplayWidth;
  let targetX, targetY;

  if (settings.webcamCustomX !== undefined && settings.webcamCustomY !== undefined) {
    targetX = Math.round(settings.webcamCustomX * (config.width - webcamDisplayWidth));
    targetY = Math.round(settings.webcamCustomY * (config.height - webcamDisplayHeight));
  } else {
    const margin = 20;
    switch (settings.webcamPosition) {
      case "top-left": targetX = margin; targetY = margin; break;
      case "top-right": targetX = config.width - webcamDisplayWidth - margin; targetY = margin; break;
      case "bottom-left": targetX = margin; targetY = config.height - webcamDisplayHeight - margin; break;
      default: targetX = config.width - webcamDisplayWidth - margin; targetY = config.height - webcamDisplayHeight - margin;
    }
  }

  const centerRefWidth = settings.displayWidth || config.width;
  const centerRefHeight = settings.displayHeight || config.height;
  const centerDisplayWidth = Math.min(centerRefWidth, centerRefHeight) * 0.45;
  const centerX = (config.width - centerDisplayWidth) / 2;
  const centerY = (config.height - centerDisplayWidth) / 2;

  const currentWidth = webcamDisplayWidth + ((centerDisplayWidth - webcamDisplayWidth) * ease);
  const currentX = targetX + ((centerX - targetX) * ease);
  const currentY = targetY + ((centerY - targetY) * ease);

  const cx = currentX + currentWidth / 2;
  const cy = currentY + currentWidth / 2;
  const radius = currentWidth / 2;

  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.45)";
  ctx.shadowBlur = 15;
  ctx.shadowOffsetY = 5;
  // Remove shadow offset on x for symmetrical look
  ctx.shadowOffsetX = 0;
  
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();

  ctx.shadowColor = "transparent";
  ctx.beginPath();
  ctx.arc(cx, cy, Math.max(0, radius - 3), 0, Math.PI * 2);
  ctx.clip();

  // VideoFrames provide displayWidth/displayHeight
  const srcSize = Math.min(webcamFrame.displayWidth, webcamFrame.displayHeight);
  const srcX = (webcamFrame.displayWidth - srcSize) / 2;
  const srcY = (webcamFrame.displayHeight - srcSize) / 2;

  ctx.drawImage(webcamFrame, srcX, srcY, srcSize, srcSize, cx - radius, cy - radius, radius * 2, radius * 2);
  ctx.restore();
}

function cleanup() {
  isRunning = false;
  if (latestScreenFrame) latestScreenFrame.close();
  if (latestWebcamFrame) latestWebcamFrame.close();
  if (latestAnnotationBitmap) latestAnnotationBitmap.close();
  if (latestTempAnnotationBitmap) latestTempAnnotationBitmap.close();
  if (latestWatermarkBitmap) latestWatermarkBitmap.close();
  latestScreenFrame = latestWebcamFrame = latestAnnotationBitmap = latestTempAnnotationBitmap = latestWatermarkBitmap = null;
  canvas = ctx = null;
}
