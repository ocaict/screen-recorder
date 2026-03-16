class AnnotationPalette {
    constructor() {
        this.currentTool = "pen";
        this.currentColor = "#ff0000";
        this.isDragging = false;
        this.startX = 0;
        this.startY = 0;
        this.winX = 0;
        this.winY = 0;
        this.animationFrameId = null;

        this.init();
    }

    init() {
        this.toolBtns = document.querySelectorAll(".tool-btn");
        this.colorBtns = document.querySelectorAll(".color-btn");
        this.undoBtn = document.getElementById("undoBtn");
        this.clearBtn = document.getElementById("clearBtn");
        this.closeBtn = document.getElementById("closeBtn");
        this.dragHandle = document.querySelector(".drag-handle");

        this.setupToolEvents();
        this.setupColorEvents();
        this.setupActionEvents();
        this.setupDragEvents();
        this.setupShortcutEvents();

        // Listen for main window or mini controls syncing us
        window.electronAPI?.onAnnotationSettings((settings) => {
            if (settings.tool) this.updateToolUI(settings.tool);
            if (settings.color) this.updateColorUI(settings.color);
        });

        console.log("Annotation Palette Initialized");
    }

    setupToolEvents() {
        this.toolBtns.forEach(btn => {
            btn.addEventListener("click", () => {
                const tool = btn.dataset.tool;
                this.updateToolUI(tool);
                window.electronAPI?.sendAnnotationPaletteCommand({ action: "set-tool", value: tool });
            });
        });
    }

    setupColorEvents() {
        this.colorBtns.forEach(btn => {
            btn.addEventListener("click", () => {
                const color = btn.dataset.color;
                this.updateColorUI(color);
                window.electronAPI?.sendAnnotationPaletteCommand({ action: "set-color", value: color });
            });
        });
    }

    setupActionEvents() {
        this.undoBtn.addEventListener("click", () => {
            window.electronAPI?.sendAnnotationPaletteCommand({ action: "undo" });
        });
        this.clearBtn.addEventListener("click", () => {
            window.electronAPI?.sendAnnotationPaletteCommand({ action: "clear" });
        });
        this.closeBtn.addEventListener("click", () => {
            window.electronAPI?.sendAnnotationPaletteCommand({ action: "close" });
        });
    }

    setupDragEvents() {
        this.dragHandle.addEventListener("mousedown", (e) => {
            this.isDragging = true;
            this.startX = e.screenX;
            this.startY = e.screenY;
            const pos = window.electronAPI?.getPalettePosition();
            if (pos) {
                this.winX = pos.x;
                this.winY = pos.y;
            }
            e.preventDefault();
        });

        window.addEventListener("mousemove", (e) => {
            if (!this.isDragging) return;
            const deltaX = e.screenX - this.startX;
            const deltaY = e.screenY - this.startY;

            if (this.animationFrameId) {
                cancelAnimationFrame(this.animationFrameId);
            }

            this.animationFrameId = requestAnimationFrame(() => {
                window.electronAPI?.movePalette(this.winX + deltaX, this.winY + deltaY);
            });
        });

        window.addEventListener("mouseup", () => {
            this.isDragging = false;
            if (this.animationFrameId) {
                cancelAnimationFrame(this.animationFrameId);
                this.animationFrameId = null;
            }
        });
    }

    setupShortcutEvents() {
        window.addEventListener("keydown", (e) => {
            const key = e.key.toLowerCase();
            switch (key) {
                case "p": this.setTool("pen"); break;
                case "h": this.setTool("highlighter"); break;
                case "a": this.setTool("arrow"); break;
                case "r": this.setTool("rectangle"); break;
                case "e": this.setTool("ellipse"); break;
                case "t": this.setTool("text"); break;
                case "c": this.clearAll(); break;
                case "escape": this.close(); break;
            }
            if (e.ctrlKey && key === "z") this.undo();
        });
    }

    setTool(tool) {
        this.updateToolUI(tool);
        window.electronAPI?.sendAnnotationPaletteCommand({ action: "set-tool", value: tool });
    }

    undo() { window.electronAPI?.sendAnnotationPaletteCommand({ action: "undo" }); }
    clearAll() { window.electronAPI?.sendAnnotationPaletteCommand({ action: "clear" }); }
    close() { window.electronAPI?.sendAnnotationPaletteCommand({ action: "close" }); }

    updateToolUI(tool) {
        this.currentTool = tool;
        this.toolBtns.forEach(btn => {
            btn.classList.toggle("active", btn.dataset.tool === tool);
        });
    }

    updateColorUI(color) {
        this.currentColor = color;
        this.colorBtns.forEach(btn => {
            btn.classList.toggle("active", btn.dataset.color === color);
        });
    }
}

document.addEventListener("DOMContentLoaded", () => {
    new AnnotationPalette();
});
