/**
 * Overlay Annotation Renderer
 * Runs inside the transparent fullscreen BrowserWindow.
 * Draws directly on top of whatever is on the user's screen.
 */

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
// clickHighlightsEnabled moved to highlight logic section below

console.log('[Overlay] Script initialized');

// ── Canvas sizing ─────────────────────────────────────────────────────────────
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
resize();
window.addEventListener("resize", resize);

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
let isCtrlPressed = false;
let mouseX = 0;
let mouseY = 0;

function createRipple(x, y, button, manual = false) {
    if (!clickHighlightsEnabled) return;

    activeRipples.push({
        x, y,
        button: manual ? 0 : button,
        radius: 10,
        maxRadius: manual ? 70 : 50, // Reduced from 140/100
        opacity: manual ? 1 : 0.7,
        startTime: Date.now(),
        duration: 400 // ms
    });

    if (activeRipples.length === 1) {
        requestAnimationFrame(animateRipples);
    }
}

// Global Key tracking for "Force Highlights" mode
window.addEventListener('keydown', (e) => {
    if (e.key === 'Control') isCtrlPressed = true;
});
window.addEventListener('keyup', (e) => {
    if (e.key === 'Control') isCtrlPressed = false;
});

function animateRipples() {
    tempCtx.clearRect(0, 0, tempCanvas.width, tempCanvas.height);
    const now = Date.now();

    // 1. Draw Cursor Glow (Professional Aura)
    if (clickHighlightsEnabled) {
        tempCtx.save();
        const size = isCtrlPressed ? 35 : 25;
        const color = isCtrlPressed ? '255, 235, 59' : '255, 235, 59';

        const gradient = tempCtx.createRadialGradient(mouseX, mouseY, 0, mouseX, mouseY, size);
        gradient.addColorStop(0, `rgba(${color}, 0.3)`);
        gradient.addColorStop(1, `rgba(${color}, 0)`);

        tempCtx.beginPath();
        tempCtx.arc(mouseX, mouseY, size, 0, Math.PI * 2);
        tempCtx.fillStyle = gradient;
        tempCtx.fill();

        // Stylized precision ring
        tempCtx.beginPath();
        tempCtx.arc(mouseX, mouseY, 15, 0, Math.PI * 2);
        tempCtx.strokeStyle = `rgba(${color}, 0.15)`;
        tempCtx.lineWidth = 1;
        tempCtx.stroke();

        tempCtx.restore();
    }

    // 2. Animate and Draw Ripples
    activeRipples = activeRipples.filter(ripple => {
        const elapsed = now - ripple.startTime;
        const progress = Math.min(elapsed / ripple.duration, 1);

        // Calculate radius based on its unique maxRadius
        ripple.radius = 10 + (progress * (ripple.maxRadius - 10));
        ripple.opacity = 0.9 * (1 - progress);

        // Draw the ripple
        tempCtx.beginPath();
        tempCtx.arc(ripple.x, ripple.y, ripple.radius, 0, Math.PI * 2);

        if (ripple.button === 2) { // Right Click
            tempCtx.strokeStyle = `rgba(33, 150, 243, ${ripple.opacity})`;
            tempCtx.lineWidth = 3;
        } else { // Left Click
            tempCtx.strokeStyle = `rgba(255, 235, 59, ${ripple.opacity})`;
            tempCtx.lineWidth = 3;
        }

        tempCtx.stroke();

        return progress < 1;
    });

    if (activeRipples.length > 0 || clickHighlightsEnabled) {
        requestAnimationFrame(animateRipples);
    } else {
        // Final clear when done
        tempCtx.clearRect(0, 0, tempCanvas.width, tempCanvas.height);
    }
}

const handleStealthClick = (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;

    // Pointing Detection: if user stops moving, trigger a pulse
    if (clickHighlightsEnabled) {
        clearTimeout(hoverTimer);
        hoverTimer = setTimeout(() => {
            if (activeRipples.length < 3) { // Prevent spamming
                createRipple(mouseX, mouseY, 0); // Trigger "Pointing highlight"
            }
        }, 400); // 400ms pause = "pointing"

        // Manual Trigger: If moving while Ctrl is pressed
        if (isCtrlPressed) {
            createRipple(mouseX, mouseY, 0, true);
        }
    }

    // If highlights are active, we keep the animation loop running
    if (clickHighlightsEnabled && activeRipples.length === 0) {
        requestAnimationFrame(animateRipples);
    }
};

// Global mouse tracker for highlights
document.addEventListener("mousemove", handleStealthClick, true);
document.addEventListener("pointermove", handleStealthClick, true);

// Force capture all mouse events when is-drawing
// Using multiple event types to ensure Windows forwards at least one
const handleGlobalEvent = (e) => {
    // Re-check enabled state in case sync was missed
    if (!clickHighlightsEnabled) return;

    if (e.type === 'mousedown' || e.type === 'pointerdown' || e.type === 'auxclick') {
        isMouseDown = true;
        lastButton = e.button;
        createRipple(e.clientX, e.clientY, e.button);
    } else if (e.type === 'mouseup' || e.type === 'pointerup') {
        isMouseDown = false;
    }
};

window.addEventListener("mousedown", handleGlobalEvent, true);
window.addEventListener("pointerdown", handleGlobalEvent, true);
window.addEventListener("mouseup", handleGlobalEvent, true);
window.addEventListener("pointerup", handleGlobalEvent, true);
window.addEventListener("auxclick", handleGlobalEvent, true);

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

function handleMouseDown(e) {
    if (currentTool === "text") {
        addText(e.clientX, e.clientY);
        return;
    }

    isDrawing = true;
    // Use client coordinates directly for drawing on the overlay
    startX = e.clientX;
    startY = e.clientY;
    currentPath = [{ x: startX, y: startY }];
    applyStyle(tempCtx);

    window.electronAPI.sendOverlayAction({
        type: "mousedown",
        x: startX,
        y: startY,
        tool: currentTool,
        color: currentColor,
        width: strokeWidth
    });
}

function handleMouseMove(e) {
    if (!isDrawing) return;
    // Use client coordinates directly for drawing on the overlay
    const x = e.clientX;
    const y = e.clientY;
    tempCtx.clearRect(0, 0, tempCanvas.width, tempCanvas.height);
    applyStyle(tempCtx);

    if (currentTool === "pen" || currentTool === "highlighter") {
        currentPath.push({ x, y });
        tempCtx.beginPath();
        tempCtx.moveTo(currentPath[0].x, currentPath[0].y);
        for (let i = 1; i < currentPath.length; i++) tempCtx.lineTo(currentPath[i].x, currentPath[i].y);
        tempCtx.stroke();
    } else if (currentTool === "arrow") {
        drawArrow(tempCtx, startX, startY, x, y);
    } else if (currentTool === "rectangle") {
        tempCtx.strokeRect(startX, startY, x - startX, y - startY);
    } else if (currentTool === "ellipse") {
        drawEllipse(tempCtx, startX, startY, x - startX, y - startY);
    }

    window.electronAPI.sendOverlayAction({ type: "mousemove", x, y });
}

function handleMouseUp(e) {
    if (!isDrawing) return;
    // Use client coordinates directly for drawing on the overlay
    const endX = e.clientX;
    const endY = e.clientY;
    tempCtx.clearRect(0, 0, tempCanvas.width, tempCanvas.height);
    applyStyle(ctx);

    if (currentTool === "pen" || currentTool === "highlighter") {
        ctx.beginPath();
        ctx.moveTo(currentPath[0].x, currentPath[0].y);
        for (let i = 1; i < currentPath.length; i++) ctx.lineTo(currentPath[i].x, currentPath[i].y);
        ctx.stroke();
        saveHistory({ type: currentTool, path: [...currentPath], color: currentColor, strokeWidth, alpha: ctx.globalAlpha });
    } else if (currentTool === "arrow") {
        drawArrow(ctx, startX, startY, endX, endY);
        saveHistory({ type: "arrow", startX, startY, endX, endY, color: currentColor, strokeWidth });
    } else if (currentTool === "rectangle") {
        ctx.strokeRect(startX, startY, endX - startX, endY - startY);
        saveHistory({ type: "rectangle", x: startX, y: startY, width: endX - startX, height: endY - startY, color: currentColor, strokeWidth });
    } else if (currentTool === "ellipse") {
        drawEllipse(ctx, startX, startY, endX - startX, endY - startY);
        saveHistory({ type: "ellipse", x: startX, y: startY, width: endX - startX, height: endY - startY, color: currentColor, strokeWidth });
    }

    window.electronAPI.sendOverlayAction({ type: "mouseup", x: endX, y: endY });
    isDrawing = false;
    currentPath = [];
}

// ── Tool / color / width updates from main window ────────────────────────────
window.electronAPI.onOverlaySettings((settings) => {
    if (settings.tool) currentTool = settings.tool;
    if (settings.color) currentColor = settings.color;
    if (settings.width) strokeWidth = settings.width;
    if (settings.showClickHighlights !== undefined) {
        clickHighlightsEnabled = !!settings.showClickHighlights;
        console.log('[Overlay] Click highlights enabled:', clickHighlightsEnabled);
        if (clickHighlightsEnabled) {
            document.body.classList.add('highlights-active');
            updateDebugInfo();
            // Show a temporary indicator for debug
            const indicator = document.createElement('div');
            indicator.style.cssText = 'position:fixed; top:10px; left:50%; transform:translateX(-50%); background:rgba(255,235,59,0.8); color:black; padding:5px 15px; border-radius:20px; font-weight:bold; z-index:10000; pointer-events:none;';
            indicator.innerText = 'CLICK HIGHLIGHTS ACTIVE';
            document.body.appendChild(indicator);
            setTimeout(() => indicator.remove(), 2000);
        } else {
            document.body.classList.remove('highlights-active');
        }
    }
});

// ── Clear / undo from main window ─────────────────────────────────────────────
window.electronAPI.onOverlayCommand((cmd) => {
    if (cmd === "undo") undo();
    if (cmd === "clear") clearAll();
});

// ── Canvas setup (for drawing) ─────────────────────────────────────────────────
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;
tempCanvas.width = window.innerWidth;
tempCanvas.height = window.innerHeight;
ctx.lineCap = "round";
ctx.lineJoin = "round";
tempCtx.lineCap = "round";
tempCtx.lineJoin = "round";

window.addEventListener("resize", () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    tempCanvas.width = window.innerWidth;
    tempCanvas.height = window.innerHeight;
    redrawHistory();
});

// ── Drawing helpers ───────────────────────────────────────────────────────────
function applyStyle(c) {
    c.strokeStyle = currentColor;
    c.lineWidth = currentTool === "highlighter" ? 20 : strokeWidth;
    c.globalAlpha = currentTool === "highlighter" ? 0.4 : 1;
    c.lineCap = "round";
    c.lineJoin = "round";
}

function drawArrow(c, fx, fy, tx, ty) {
    const headLen = 15;
    const angle = Math.atan2(ty - fy, tx - fx);
    c.beginPath(); c.moveTo(fx, fy); c.lineTo(tx, ty); c.stroke();
    c.beginPath();
    c.moveTo(tx, ty);
    c.lineTo(tx - headLen * Math.cos(angle - Math.PI / 6), ty - headLen * Math.sin(angle - Math.PI / 6));
    c.moveTo(tx, ty);
    c.lineTo(tx - headLen * Math.cos(angle + Math.PI / 6), ty - headLen * Math.sin(angle + Math.PI / 6));
    c.stroke();
}

function drawEllipse(c, x, y, w, h) {
    c.beginPath();
    c.ellipse(x + w / 2, y + h / 2, Math.abs(w / 2), Math.abs(h / 2), 0, 0, 2 * Math.PI);
    c.stroke();
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
            ctx.beginPath(); ctx.moveTo(a.path[0].x, a.path[0].y);
            for (let i = 1; i < a.path.length; i++) ctx.lineTo(a.path[i].x, a.path[i].y);
            ctx.stroke();
        } else if (a.type === "arrow") { drawArrow(ctx, a.startX, a.startY, a.endX, a.endY); }
        else if (a.type === "rectangle") { ctx.strokeRect(a.x, a.y, a.width, a.height); }
        else if (a.type === "ellipse") { drawEllipse(ctx, a.x, a.y, a.width, a.height); }
        else if (a.type === "text") {
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
    redrawHistory();
}

function clearAll() {
    history = [];
    historyIndex = -1;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    tempCtx.clearRect(0, 0, tempCanvas.width, tempCanvas.height);

    document.querySelectorAll(".annotation-text-input").forEach(i => i.remove());
    textInput = null;

    if (window.electronAPI.setOverlayFocusable) {
        window.electronAPI.setOverlayFocusable(false);
    }
}
