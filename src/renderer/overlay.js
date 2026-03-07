
// Initialize canvases
const canvas = document.getElementById("annotationCanvas");
const tempCanvas = document.getElementById("tempCanvas");
const ctx = canvas.getContext("2d");
const tempCtx = tempCanvas.getContext("2d");

// ── State ────────────────────────────────────────────────────────────────────
let currentTool = "pen";
let currentColor = "#ff0000";
let strokeWidth = 3;
let isDrawing = false;
let startX = 0, startY = 0;
let currentPath = [];
let history = [];
let historyIndex = -1;
let drawModeActive = false;
let textInput = null;
let laserPaths = []; // Store temporary laser trails
let stepCounter = 1;
// clickHighlightsEnabled moved to highlight logic section below

console.log('[Overlay] Script initialized');

// ── Canvas sizing ─────────────────────────────────────────────────────────────
let resizeTimeout = null;
function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    tempCanvas.width = window.innerWidth;
    tempCanvas.height = window.innerHeight;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    tempCtx.lineCap = "round";
    tempCtx.lineJoin = "round";
    redrawHistory();
}

function debouncedResize() {
    if (resizeTimeout) clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(resize, 150);
}

resize();
window.addEventListener("resize", debouncedResize);

// ── Draw-mode toggle (sent from main process via IPC) ─────────────────────────
window.electronAPI.onOverlayDrawMode((enabled) => {
    drawModeActive = enabled;
    console.log('[Overlay] Draw mode:', enabled);
    if (enabled) {
        document.body.classList.add("is-drawing");
    } else {
        document.body.classList.remove("is-drawing");
        isDrawing = false;
        currentPath = [];
    }
});

let activeRipples = [];
let lastButton = 0;
let clickCount = 0;
let clickHighlightsEnabled = false;
let hoverTimer = null;
let mouseX = 0;
let mouseY = 0;
let isAnimating = false; // Guards against concurrent rAF loops

// Highlight customization settings
let highlightSettings = {
    leftColor: "#FFEB3B",
    rightColor: "#2196F3",
    rippleSize: 50,
    rippleSpeed: 400,
    glowSize: 25,
    glowIntensity: 30
};

// Listen for global mouse clicks from uiohook (main process)
window.electronAPI.onGlobalClick((data) => {
    if (clickHighlightsEnabled && data) {
        createRipple(data.x, data.y, data.button);
    }
});

// Also listen for direct DOM mouse events (when overlay captures them)
document.addEventListener("mousedown", (e) => {
    if (clickHighlightsEnabled) {
        createRipple(e.clientX, e.clientY, e.button);
    }
}, true);

function createRipple(x, y, button, manual = false) {
    if (!clickHighlightsEnabled) return;

    activeRipples.push({
        x, y,
        button: manual ? 0 : button,
        radius: 10,
        maxRadius: manual ? highlightSettings.rippleSize * 1.4 : highlightSettings.rippleSize,
        opacity: manual ? 1 : 0.7,
        startTime: Date.now(),
        duration: manual ? highlightSettings.rippleSpeed : highlightSettings.rippleSpeed
    });

    if (!isAnimating) {
        isAnimating = true;
        requestAnimationFrame(animateRipples);
    }
}

function createLaserPath() {
    return {
        points: [],
        startTime: Date.now(),
        color: currentColor,
        width: 4, // Lasers look better at a fixed thin width
        active: true
    };
}

function animateRipples() {
    tempCtx.clearRect(0, 0, tempCanvas.width, tempCanvas.height);
    const now = Date.now();

    // Redraw active normal pen/shapes if we are drawing something other than laser
    if (isDrawing && currentTool !== "laser" && currentPath.length > 0) {
        applyStyle(tempCtx);
        if (currentTool === "pen" || currentTool === "highlighter") {
            tempCtx.beginPath();
            if (currentPath.length < 3) {
                tempCtx.moveTo(currentPath[0].x, currentPath[0].y);
                tempCtx.lineTo(currentPath[currentPath.length - 1].x, currentPath[currentPath.length - 1].y);
            } else {
                tempCtx.moveTo(currentPath[0].x, currentPath[0].y);
                let i;
                for (i = 1; i < currentPath.length - 2; i++) {
                    const xc = (currentPath[i].x + currentPath[i + 1].x) / 2;
                    const yc = (currentPath[i].y + currentPath[i + 1].y) / 2;
                    tempCtx.quadraticCurveTo(currentPath[i].x, currentPath[i].y, xc, yc);
                }
                tempCtx.quadraticCurveTo(currentPath[i].x, currentPath[i].y, currentPath[i + 1].x, currentPath[i + 1].y);
            }
            tempCtx.stroke();
        } else if (currentTool === "arrow") {
            drawArrow(tempCtx, startX, startY, mouseX, mouseY, false);
        } else if (currentTool === "double-arrow") {
            drawArrow(tempCtx, startX, startY, mouseX, mouseY, true);
        } else if (currentTool === "rectangle") {
            tempCtx.strokeRect(startX, startY, mouseX - startX, mouseY - startY);
        } else if (currentTool === "ellipse") {
            drawEllipse(tempCtx, startX, startY, mouseX - startX, mouseY - startY);
        }
    }

    // 1. Draw Cursor Glow (always on when highlights enabled)
    if (clickHighlightsEnabled) {
        tempCtx.save();
        const size = highlightSettings.glowSize;
        const intensity = highlightSettings.glowIntensity / 100;

        // Convert hex to RGB
        const leftColor = hexToRgb(highlightSettings.leftColor);

        const gradient = tempCtx.createRadialGradient(mouseX, mouseY, 0, mouseX, mouseY, size);
        gradient.addColorStop(0, `rgba(${leftColor.r}, ${leftColor.g}, ${leftColor.b}, ${intensity})`);
        gradient.addColorStop(1, `rgba(${leftColor.r}, ${leftColor.g}, ${leftColor.b}, 0)`);

        tempCtx.beginPath();
        tempCtx.arc(mouseX, mouseY, size, 0, Math.PI * 2);
        tempCtx.fillStyle = gradient;
        tempCtx.fill();

        // Stylized precision ring
        tempCtx.beginPath();
        tempCtx.arc(mouseX, mouseY, size * 0.6, 0, Math.PI * 2);
        tempCtx.strokeStyle = `rgba(${leftColor.r}, ${leftColor.g}, ${leftColor.b}, ${intensity * 0.5})`;
        tempCtx.lineWidth = 1;
        tempCtx.stroke();

        tempCtx.restore();
    }

    // 2. Animate and Draw Ripples
    activeRipples = activeRipples.filter(ripple => {
        const elapsed = now - ripple.startTime;
        const progress = Math.min(elapsed / ripple.duration, 1);

        ripple.radius = 10 + (progress * (ripple.maxRadius - 10));
        ripple.opacity = 0.9 * (1 - progress);

        tempCtx.beginPath();
        tempCtx.arc(ripple.x, ripple.y, ripple.radius, 0, Math.PI * 2);

        let color;
        if (ripple.button === 2) {
            const rightColor = hexToRgb(highlightSettings.rightColor);
            color = `rgba(${rightColor.r}, ${rightColor.g}, ${rightColor.b}, ${ripple.opacity})`;
        } else {
            const leftColor = hexToRgb(highlightSettings.leftColor);
            color = `rgba(${leftColor.r}, ${leftColor.g}, ${leftColor.b}, ${ripple.opacity})`;
        }

        tempCtx.strokeStyle = color;
        tempCtx.lineWidth = 3;
        tempCtx.stroke();

        return progress < 1;
    });

    // 3. Animate and Draw Laser Paths
    laserPaths = laserPaths.filter(laser => {
        const elapsed = now - laser.startTime;
        const duration = 2000; // Laser lasts 2 seconds
        const opacity = Math.max(0, 1 - (elapsed / duration));

        if (opacity <= 0) return false;

        tempCtx.save();
        tempCtx.beginPath();
        tempCtx.strokeStyle = laser.color;
        tempCtx.lineWidth = laser.width;
        tempCtx.globalAlpha = opacity;
        tempCtx.lineCap = "round";
        tempCtx.lineJoin = "round";
        tempCtx.shadowBlur = 8;
        tempCtx.shadowColor = laser.color;

        const pts = laser.points;
        if (pts.length > 0) {
            tempCtx.moveTo(pts[0].x, pts[0].y);
            // Use smoothing for laser too
            for (let i = 1; i < pts.length - 2; i++) {
                const xc = (pts[i].x + pts[i + 1].x) / 2;
                const yc = (pts[i].y + pts[i + 1].y) / 2;
                tempCtx.quadraticCurveTo(pts[i].x, pts[i].y, xc, yc);
            }
            if (pts.length > 2) {
                const i = pts.length - 2;
                tempCtx.quadraticCurveTo(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y);
            } else if (pts.length === 2) {
                tempCtx.lineTo(pts[1].x, pts[1].y);
            }
            tempCtx.stroke();
        }
        tempCtx.restore();

        return true;
    });

    // Keep looping only while there is something to actually draw.
    // Cursor glow restarts the loop from handleStealthClick on next mouse move.
    if (activeRipples.length > 0 || laserPaths.length > 0) {
        requestAnimationFrame(animateRipples);
    } else {
        isAnimating = false;
        tempCtx.clearRect(0, 0, tempCanvas.width, tempCanvas.height);
    }
}

// Helper function to convert hex to RGB
function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : { r: 255, g: 235, b: 59 };
}

const handleStealthClick = (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;

    // Restart the animation loop on mouse movement to update the cursor glow,
    // but only if the loop is not already running.
    if (clickHighlightsEnabled && !isAnimating) {
        isAnimating = true;
        requestAnimationFrame(animateRipples);
    }
};

// Global mouse tracker for highlights
document.addEventListener("mousemove", handleStealthClick, true);
document.addEventListener("pointermove", handleStealthClick, true);

// Force capture all mouse events when is-drawing
// Using multiple event types to ensure Windows forwards at least one
// Note: click highlights now use global uiohook instead of DOM events

document.addEventListener("mousedown", (e) => {
    if (document.body.classList.contains("is-drawing")) {
        e.preventDefault();
        e.stopPropagation();
        handleMouseDown(e);
    }
}, true);

document.addEventListener("mousemove", (e) => {
    if (document.body.classList.contains("is-drawing")) {
        e.preventDefault();
        e.stopPropagation();
        handleMouseMove(e);
    }
}, true);

document.addEventListener("mouseup", (e) => {
    if (document.body.classList.contains("is-drawing")) {
        e.preventDefault();
        e.stopPropagation();
        handleMouseUp(e);
    }
}, true);

// Tracking bounds for dirty rectangle rendering
let dirtyRect = { minX: 0, minY: 0, maxX: 0, maxY: 0 };

function handleMouseDown(e) {
    if (currentTool === "text") {
        addText(e.clientX, e.clientY);
        return;
    }

    if (currentTool === "eraser") {
        isDrawing = true;
        hitTestAndErase(e.clientX, e.clientY);
        return;
    }

    isDrawing = true;
    // Use client coordinates directly for drawing on the overlay
    startX = e.clientX;
    startY = e.clientY;
    currentPath = [{ x: startX, y: startY }];

    // Initialize dirty rect for this new stroke, adding a bit of padding for stroke width
    const padding = (currentTool === "highlighter" ? 30 : Math.max(strokeWidth * 4, 100));
    dirtyRect = {
        minX: startX - padding,
        minY: startY - padding,
        maxX: startX + padding,
        maxY: startY + padding
    };

    if (currentTool === "laser") {
        const newLaser = createLaserPath();
        newLaser.points.push({ x: startX, y: startY });
        laserPaths.push(newLaser);
        requestAnimationFrame(animateRipples);
    }

    applyStyle(tempCtx);

    if (currentTool === "step") {
        drawStep(tempCtx, startX, startY, stepCounter, currentColor, strokeWidth);
    }

    window.electronAPI.sendOverlayAction({
        type: "mousedown",
        x: startX,
        y: startY,
        tool: currentTool,
        color: currentColor,
        width: strokeWidth
    });
}

function hitTestAndErase(x, y) {
    if (historyIndex < 0) return false;

    let erased = false;
    for (let h = historyIndex; h >= 0; h--) {
        const a = history[h];
        tempCtx.beginPath();

        const testWidth = Math.max((a.strokeWidth || strokeWidth) + 15, 25);
        tempCtx.lineWidth = testWidth;
        tempCtx.lineCap = "round";
        tempCtx.lineJoin = "round";

        let hit = false;
        if (a.type === "pen" || a.type === "highlighter") {
            if (a.path.length < 3) {
                if (a.path.length > 0) {
                    tempCtx.moveTo(a.path[0].x, a.path[0].y);
                    if (a.path.length > 1) {
                        tempCtx.lineTo(a.path[a.path.length - 1].x, a.path[a.path.length - 1].y);
                    }
                }
            } else {
                tempCtx.moveTo(a.path[0].x, a.path[0].y);
                let i;
                for (i = 1; i < a.path.length - 2; i++) {
                    const xc = (a.path[i].x + a.path[i + 1].x) / 2;
                    const yc = (a.path[i].y + a.path[i + 1].y) / 2;
                    tempCtx.quadraticCurveTo(a.path[i].x, a.path[i].y, xc, yc);
                }
                tempCtx.quadraticCurveTo(a.path[i].x, a.path[i].y, a.path[i + 1].x, a.path[i + 1].y);
            }
            hit = tempCtx.isPointInStroke(x, y);
        } else if (a.type === "arrow" || a.type === "double-arrow") {
            drawArrow(tempCtx, a.startX, a.startY, a.endX, a.endY, a.type === "double-arrow", false);
            hit = tempCtx.isPointInStroke(x, y);
        } else if (a.type === "rectangle") {
            tempCtx.rect(a.x, a.y, a.width, a.height);
            hit = tempCtx.isPointInStroke(x, y);
        } else if (a.type === "ellipse") {
            tempCtx.ellipse(a.x + a.width / 2, a.y + a.height / 2, Math.abs(a.width / 2), Math.abs(a.height / 2), 0, 0, 2 * Math.PI);
            hit = tempCtx.isPointInStroke(x, y);
        } else if (a.type === "step") {
            const radius = 18 + ((a.strokeWidth || strokeWidth) * 1.5);
            tempCtx.arc(a.x, a.y, radius, 0, Math.PI * 2);
            hit = tempCtx.isPointInPath(x, y);
        } else if (a.type === "text") {
            tempCtx.rect(a.x, a.y - 30, a.maxWidth || canvas.width, 40);
            hit = tempCtx.isPointInPath(x, y); // fill hit
        }

        if (hit) {
            history.splice(h, 1);
            historyIndex--;
            // Keep step counter in sync with remaining steps
            stepCounter = history.filter(a => a.type === "step").length + 1;
            erased = true;
            window.electronAPI.sendOverlayAction({ type: "eraseItem", index: h });
            break;
        }
    }

    if (erased) {
        redrawHistory();
    }
    return erased;
}

function handleMouseMove(e) {
    if (!isDrawing) return;
    // Use client coordinates directly for drawing on the overlay
    const x = e.clientX;
    const y = e.clientY;

    if (currentTool === "eraser") {
        hitTestAndErase(x, y);
        window.electronAPI.sendOverlayAction({ type: "mousemove", x, y });
        return;
    }

    // Clear only the dirty rectangle instead of the whole screen
    // For laser tool, DO NOT clear here, let the animateRipples loop handle it
    if (currentTool !== "laser") {
        tempCtx.clearRect(dirtyRect.minX, dirtyRect.minY, dirtyRect.maxX - dirtyRect.minX, dirtyRect.maxY - dirtyRect.minY);
    }

    // Use a larger padding to ensure arrow heads and thick strokes are fully cleared
    const padding = (currentTool === "highlighter" ? 30 : Math.max(strokeWidth * 4, 40)); // Increased padding for arrow wings
    dirtyRect.minX = Math.min(dirtyRect.minX, x - padding);
    dirtyRect.minY = Math.min(dirtyRect.minY, y - padding);
    dirtyRect.maxX = Math.max(dirtyRect.maxX, x + padding);
    dirtyRect.maxY = Math.max(dirtyRect.maxY, y + padding);

    applyStyle(tempCtx);

    if (currentTool === "pen" || currentTool === "highlighter") {
        currentPath.push({ x, y });
        tempCtx.beginPath();
        if (currentPath.length < 3) {
            tempCtx.moveTo(currentPath[0].x, currentPath[0].y);
            tempCtx.lineTo(x, y);
        } else {
            tempCtx.moveTo(currentPath[0].x, currentPath[0].y);
            let i;
            for (i = 1; i < currentPath.length - 2; i++) {
                const xc = (currentPath[i].x + currentPath[i + 1].x) / 2;
                const yc = (currentPath[i].y + currentPath[i + 1].y) / 2;
                tempCtx.quadraticCurveTo(currentPath[i].x, currentPath[i].y, xc, yc);
            }
            tempCtx.quadraticCurveTo(currentPath[i].x, currentPath[i].y, currentPath[i + 1].x, currentPath[i + 1].y);
        }
        tempCtx.stroke();
    } else if (currentTool === "laser") {
        const laser = laserPaths[laserPaths.length - 1];
        if (laser) laser.points.push({ x, y });
    } else if (currentTool === "arrow") {
        drawArrow(tempCtx, startX, startY, x, y, false);
    } else if (currentTool === "double-arrow") {
        drawArrow(tempCtx, startX, startY, x, y, true);
    } else if (currentTool === "rectangle") {
        tempCtx.strokeRect(startX, startY, x - startX, y - startY);
    } else if (currentTool === "ellipse") {
        drawEllipse(tempCtx, startX, startY, x - startX, y - startY);
    } else if (currentTool === "step") {
        drawStep(tempCtx, x, y, stepCounter, currentColor, strokeWidth);
    }

    window.electronAPI.sendOverlayAction({ type: "mousemove", x, y });
}

function handleMouseUp(e) {
    if (!isDrawing) return;
    // Use client coordinates directly for drawing on the overlay
    const endX = e.clientX;
    const endY = e.clientY;

    if (currentTool === "eraser") {
        isDrawing = false;
        window.electronAPI.sendOverlayAction({ type: "mouseup", x: endX, y: endY });
        return;
    }

    // Clear only the dirty rectangle on the temp canvas
    if (currentTool !== "laser") {
        tempCtx.clearRect(Math.floor(dirtyRect.minX), Math.floor(dirtyRect.minY), Math.ceil(dirtyRect.maxX - dirtyRect.minX), Math.ceil(dirtyRect.maxY - dirtyRect.minY));
    }

    applyStyle(ctx);

    if (currentTool === "pen" || currentTool === "highlighter") {
        ctx.beginPath();
        if (currentPath.length < 3) {
            ctx.moveTo(currentPath[0].x, currentPath[0].y);
            ctx.lineTo(endX, endY);
        } else {
            ctx.moveTo(currentPath[0].x, currentPath[0].y);
            let i;
            for (i = 1; i < currentPath.length - 2; i++) {
                const xc = (currentPath[i].x + currentPath[i + 1].x) / 2;
                const yc = (currentPath[i].y + currentPath[i + 1].y) / 2;
                ctx.quadraticCurveTo(currentPath[i].x, currentPath[i].y, xc, yc);
            }
            ctx.quadraticCurveTo(currentPath[i].x, currentPath[i].y, currentPath[i + 1].x, currentPath[i + 1].y);
        }
        ctx.stroke();
        saveHistory({ type: currentTool, path: [...currentPath], color: currentColor, strokeWidth, alpha: ctx.globalAlpha });
    } else if (currentTool === "laser") {
        // Laser is never saved to history
    } else if (currentTool === "arrow") {
        drawArrow(ctx, startX, startY, endX, endY, false);
        saveHistory({ type: "arrow", startX, startY, endX, endY, color: currentColor, strokeWidth });
    } else if (currentTool === "double-arrow") {
        drawArrow(ctx, startX, startY, endX, endY, true);
        saveHistory({ type: "double-arrow", startX, startY, endX, endY, color: currentColor, strokeWidth });
    } else if (currentTool === "rectangle") {
        ctx.strokeRect(startX, startY, endX - startX, endY - startY);
        saveHistory({ type: "rectangle", x: startX, y: startY, width: endX - startX, height: endY - startY, color: currentColor, strokeWidth });
    } else if (currentTool === "ellipse") {
        drawEllipse(ctx, startX, startY, endX - startX, endY - startY);
        saveHistory({ type: "ellipse", x: startX, y: startY, width: endX - startX, height: endY - startY, color: currentColor, strokeWidth });
    } else if (currentTool === "step") {
        drawStep(ctx, endX, endY, stepCounter, currentColor, strokeWidth);
        saveHistory({ type: "step", x: endX, y: endY, color: currentColor, strokeWidth, stepNumber: stepCounter });
        stepCounter++;
    }

    window.electronAPI.sendOverlayAction({ type: "mouseup", x: endX, y: endY });
    isDrawing = false;
    currentPath = [];

    // Reset dirty rect for next stroke
    dirtyRect = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
}

// ── Tool / color / width updates from main window ────────────────────────────
window.electronAPI.onOverlaySettings((settings) => {
    if (settings.tool) {
        if (settings.tool === "step" && currentTool !== "step") {
            stepCounter = 1;
        }
        currentTool = settings.tool;
    }
    if (settings.color) currentColor = settings.color;
    if (settings.width) strokeWidth = settings.width;
    if (settings.showClickHighlights !== undefined) {
        clickHighlightsEnabled = !!settings.showClickHighlights;
        if (clickHighlightsEnabled) {
            document.body.classList.add('highlights-active');
        } else {
            document.body.classList.remove('highlights-active');
        }
    }
    // Update highlight customization settings
    if (settings.highlightLeftColor) highlightSettings.leftColor = settings.highlightLeftColor;
    if (settings.highlightRightColor) highlightSettings.rightColor = settings.highlightRightColor;
    if (settings.highlightRippleSize) highlightSettings.rippleSize = settings.highlightRippleSize;
    if (settings.highlightRippleSpeed) highlightSettings.rippleSpeed = settings.highlightRippleSpeed;
    if (settings.highlightGlowSize) highlightSettings.glowSize = settings.highlightGlowSize;
    if (settings.highlightGlowIntensity) highlightSettings.glowIntensity = settings.highlightGlowIntensity;
});
// ── Clear / undo from main window ─────────────────────────────────────────────
window.electronAPI.onOverlayCommand((cmd) => {
    if (cmd === "undo") undo();
    if (cmd === "clear") clearAll();
});


// NOTE: Canvas sizes and context settings are already initialized by
// the resize() call at the top of this file (line ~44). No duplication needed.

// ── Drawing helpers ───────────────────────────────────────────────────────────
function applyStyle(c) {
    c.strokeStyle = currentColor;
    c.lineWidth = currentTool === "highlighter" ? 20 : strokeWidth;
    c.globalAlpha = currentTool === "highlighter" ? 0.4 : 1;
    c.lineCap = "round";
    c.lineJoin = "round";
}

function drawArrow(ctx, fromX, fromY, toX, toY, isDoubleHeaded = false, doStroke = true) {
    const headLength = 20;
    const angle = Math.atan2(toY - fromY, toX - fromX);

    ctx.beginPath();
    // Head at start
    if (isDoubleHeaded) {
        ctx.moveTo(fromX + headLength * Math.cos(angle + Math.PI / 6), fromY + headLength * Math.sin(angle + Math.PI / 6));
        ctx.lineTo(fromX, fromY);
        ctx.lineTo(fromX + headLength * Math.cos(angle - Math.PI / 6), fromY + headLength * Math.sin(angle - Math.PI / 6));
        ctx.moveTo(fromX, fromY);
    } else {
        ctx.moveTo(fromX, fromY);
    }

    ctx.lineTo(toX, toY);

    // Head at end
    ctx.lineTo(
        toX - headLength * Math.cos(angle - Math.PI / 6),
        toY - headLength * Math.sin(angle - Math.PI / 6),
    );
    ctx.moveTo(toX, toY);
    ctx.lineTo(
        toX - headLength * Math.cos(angle + Math.PI / 6),
        toY - headLength * Math.sin(angle + Math.PI / 6),
    );
    if (doStroke) ctx.stroke();
}

function drawEllipse(c, x, y, w, h) {
    c.beginPath();
    c.ellipse(x + w / 2, y + h / 2, Math.abs(w / 2), Math.abs(h / 2), 0, 0, 2 * Math.PI);
    c.stroke();
}

function drawStep(c, x, y, number, color, width) {
    const radius = 18 + (width * 1.5);
    c.beginPath();
    c.arc(x, y, radius, 0, Math.PI * 2);
    c.fillStyle = color;
    c.fill();
    c.strokeStyle = color === "#ffffff" ? "#000000" : "#ffffff";
    c.lineWidth = 2;
    c.stroke();

    c.fillStyle = color === "#ffffff" ? "#000000" : "#ffffff";
    c.font = `bold ${radius}px sans-serif`;
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText(number.toString(), x, y + (radius * 0.1));
}

function addText(x, y) {
    const input = document.createElement("textarea");
    input.className = "annotation-text-input";
    input.style.position = "fixed";
    input.style.left = x + "px";
    input.style.top = y + "px";
    input.style.width = Math.max(window.innerWidth - x - 10, 100) + "px";
    input.style.maxHeight = Math.max(window.innerHeight - y - 10, 40) + "px";
    input.style.color = currentColor;
    input.style.background = "transparent";
    input.style.outline = "none";
    input.style.border = "none";
    input.style.resize = "none";
    input.style.fontSize = "24px";
    input.style.fontWeight = "bold";
    input.style.fontFamily = "sans-serif";
    input.style.padding = "0";
    input.style.margin = "0";
    input.style.lineHeight = "1.2";
    input.style.overflow = "hidden";
    input.style.zIndex = "1000";
    input.style.pointerEvents = "auto";
    input.style.caretColor = currentColor;
    input.rows = 1;
    document.body.appendChild(input);

    // Auto-grow height as user types
    input.addEventListener("input", () => {
        input.style.height = "auto";
        input.style.height = input.scrollHeight + "px";
    });

    // Commit any older text inputs now that the new one exists
    document.querySelectorAll(".annotation-text-input").forEach((existing) => {
        if (existing !== input) {
            commitText(existing);
        }
    });

    if (window.electronAPI.setOverlayFocusable) {
        window.electronAPI.setOverlayFocusable(true);
    }

    setTimeout(() => {
        input.focus();
        textInput = input;
    }, 10);

    input.addEventListener("blur", () => {
        setTimeout(() => commitText(input), 100);
    });

    input.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            commitText(input);
        } else if (e.key === "Escape") {
            input.remove();
            textInput = null;
        }
        e.stopPropagation();
    });
}

function wrapText(context, text, x, y, maxWidth, lineHeight) {
    const lines = text.split("\n");
    let curY = y;
    for (const line of lines) {
        const words = line.split(" ");
        let currentLine = "";
        for (let i = 0; i < words.length; i++) {
            const testLine = currentLine + (currentLine ? " " : "") + words[i];
            const metrics = context.measureText(testLine);
            if (metrics.width > maxWidth && currentLine) {
                context.fillText(currentLine, x, curY);
                currentLine = words[i];
                curY += lineHeight;
            } else {
                currentLine = testLine;
            }
        }
        context.fillText(currentLine, x, curY);
        curY += lineHeight;
    }
    return curY;
}

function commitText(input) {
    const text = input.value.trim();
    if (text) {
        const x = parseInt(input.style.left);
        const y = parseInt(input.style.top);
        const maxW = parseInt(input.style.width) || (window.innerWidth - x - 10);

        ctx.font = "bold 24px sans-serif";
        ctx.fillStyle = currentColor;
        wrapText(ctx, text, x, y + 24, maxW, 29);

        saveHistory({
            type: "text",
            text: text,
            x: x,
            y: y + 24,
            color: currentColor,
            font: "bold 24px sans-serif",
            maxWidth: maxW,
        });

        window.electronAPI.sendOverlayAction({
            type: "textCommand",
            x: x,
            y: y + 24,
            text: text,
            color: currentColor,
            font: "bold 24px sans-serif",
            maxWidth: maxW,
        });
    }
    input.remove();

    const remaining = document.querySelector(".annotation-text-input");
    if (!remaining) {
        textInput = null;
        if (window.electronAPI.setOverlayFocusable) {
            window.electronAPI.setOverlayFocusable(false);
        }
    }
}

function redrawHistory() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const a of history) {
        ctx.strokeStyle = a.color;
        ctx.fillStyle = a.color;
        ctx.lineWidth = a.strokeWidth || strokeWidth;
        ctx.globalAlpha = a.alpha || 1;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        if (a.type === "pen" || a.type === "highlighter") {
            ctx.beginPath();
            if (a.path.length < 3) {
                if (a.path.length > 0) {
                    ctx.moveTo(a.path[0].x, a.path[0].y);
                    if (a.path.length > 1) {
                        ctx.lineTo(a.path[a.path.length - 1].x, a.path[a.path.length - 1].y);
                    }
                }
            } else {
                ctx.moveTo(a.path[0].x, a.path[0].y);
                let i;
                for (i = 1; i < a.path.length - 2; i++) {
                    const xc = (a.path[i].x + a.path[i + 1].x) / 2;
                    const yc = (a.path[i].y + a.path[i + 1].y) / 2;
                    ctx.quadraticCurveTo(a.path[i].x, a.path[i].y, xc, yc);
                }
                ctx.quadraticCurveTo(a.path[i].x, a.path[i].y, a.path[i + 1].x, a.path[i + 1].y);
            }
            ctx.stroke();
        } else if (a.type === "arrow") {
            drawArrow(ctx, a.startX, a.startY, a.endX, a.endY, false);
        } else if (a.type === "double-arrow") {
            drawArrow(ctx, a.startX, a.startY, a.endX, a.endY, true);
        } else if (a.type === "rectangle") {
            ctx.strokeRect(a.x, a.y, a.width, a.height);
        } else if (a.type === "ellipse") {
            drawEllipse(ctx, a.x, a.y, a.width, a.height);
        } else if (a.type === "step") {
            drawStep(ctx, a.x, a.y, a.stepNumber, a.color, a.strokeWidth || strokeWidth);
        } else if (a.type === "text") {
            ctx.font = a.font;
            wrapText(ctx, a.text, a.x, a.y, a.maxWidth || canvas.width, 29);
        }
    }
    ctx.globalAlpha = 1;
}

function saveHistory(action) {
    history = history.slice(0, historyIndex + 1);
    history.push(action);
    historyIndex++;
}

function undo() {
    if (historyIndex < 0) return;
    history.pop();
    historyIndex--;
    // Re-sync step counter
    stepCounter = history.filter(a => a.type === "step").length + 1;
    redrawHistory();
}

function clearAll() {
    history = [];
    historyIndex = -1;
    stepCounter = 1;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    tempCtx.clearRect(0, 0, tempCanvas.width, tempCanvas.height);

    document.querySelectorAll(".annotation-text-input").forEach(i => i.remove());
    textInput = null;

    if (window.electronAPI.setOverlayFocusable) {
        window.electronAPI.setOverlayFocusable(false);
    }
}
