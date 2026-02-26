class AnnotationManager {
  constructor(app) {
    this.app = app;
    this.isActive = false;
    this.currentTool = "pen";
    this.currentColor = "#ff0000";
    this.strokeWidth = 3;
    this.isDrawing = false;
    this.startX = 0;
    this.startY = 0;
    this.history = [];
    this.historyIndex = -1;
    this.currentPath = [];
    this.textInput = null;

    this.canvas = null;
    this.ctx = null;
    this.tempCanvas = null;
    this.tempCtx = null;
  }

  init() {
    this.createCanvas();
    this.setupToolbar();
    this.setupKeyboardShortcuts();
  }

  createCanvas() {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "annotation-canvas";
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
    document.body.insertBefore(this.canvas, document.body.firstChild);

    this.ctx = this.canvas.getContext("2d");
    this.ctx.lineCap = "round";
    this.ctx.lineJoin = "round";

    this.tempCanvas = document.createElement("canvas");
    this.tempCanvas.className = "annotation-canvas";
    this.tempCanvas.width = window.innerWidth;
    this.tempCanvas.height = window.innerHeight;
    document.body.insertBefore(this.tempCanvas, document.body.firstChild);

    this.tempCtx = this.tempCanvas.getContext("2d");
    this.tempCtx.lineCap = "round";
    this.tempCtx.lineJoin = "round";

    // Store resize handler for cleanup
    const resizeHandler = () => {
      this.canvas.width = window.innerWidth;
      this.canvas.height = window.innerHeight;
      this.tempCanvas.width = window.innerWidth;
      this.tempCanvas.height = window.innerHeight;
      this.redrawHistory();
    };
    window.__resizeHandler = resizeHandler;
    window.addEventListener("resize", resizeHandler);

    // Store canvas event handlers for cleanup
    this.canvasMousedownHandler = (e) => this.startDrawing(e);
    this.canvasMousemoveHandler = (e) => this.draw(e);
    this.canvasMouseupHandler = (e) => this.stopDrawing(e);
    this.canvasMouseleaveHandler = () => this.stopDrawing();

    this.canvasTouchstartHandler = (e) => {
      e.preventDefault();
      const touch = e.touches[0];
      this.startDrawing({ clientX: touch.clientX, clientY: touch.clientY });
    };
    this.canvasTouchmoveHandler = (e) => {
      e.preventDefault();
      const touch = e.touches[0];
      this.draw({ clientX: touch.clientX, clientY: touch.clientY });
    };
    this.canvasTouchendHandler = (e) => {
      e.preventDefault();
      this.stopDrawing();
    };

    this.canvas.addEventListener("mousedown", this.canvasMousedownHandler);
    this.canvas.addEventListener("mousemove", this.canvasMousemoveHandler);
    this.canvas.addEventListener("mouseup", this.canvasMouseupHandler);
    this.canvas.addEventListener("mouseleave", this.canvasMouseleaveHandler);

    this.canvas.addEventListener("touchstart", this.canvasTouchstartHandler);
    this.canvas.addEventListener("touchmove", this.canvasTouchmoveHandler);
    this.canvas.addEventListener("touchend", this.canvasTouchendHandler);
  }

  setupToolbar() {
    this.toolbar = document.getElementById("annotationToolbar");
    this.toolBtns = document.querySelectorAll(".annotation-btn[data-tool]");
    this.colorBtns = document.querySelectorAll(".annotation-color-btn");
    this.undoBtn = document.getElementById("annotationUndo");
    this.clearBtn = document.getElementById("annotationClear");
    this.closeBtn = document.getElementById("annotationClose");

    this.toolBtns.forEach((btn) => {
      btn._selectHandler = () => {
        this.toolBtns.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        this.currentTool = btn.dataset.tool;
        // Sync configuration with the overlay process
        if (window.electronAPI?.sendOverlaySettings) {
          window.electronAPI.sendOverlaySettings({ tool: this.currentTool });
        }
      };
      btn.addEventListener("click", btn._selectHandler);
    });

    this.colorBtns.forEach((btn) => {
      btn._selectHandler = () => {
        this.colorBtns.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        this.currentColor = btn.dataset.color;
        // Sync color configuration with the overlay process
        if (window.electronAPI?.sendOverlaySettings) {
          window.electronAPI.sendOverlaySettings({ color: this.currentColor });
        }
      };
      btn.addEventListener("click", btn._selectHandler);
    });

    this.undoBtn._clickHandler = () => this.undo();
    this.undoBtn?.addEventListener("click", this.undoBtn._clickHandler);

    this.clearBtn._clickHandler = () => this.clearAll();
    this.clearBtn?.addEventListener("click", this.clearBtn._clickHandler);

    this.closeBtn._clickHandler = () => {
      // Call the parent app's toggleAnnotation to properly tear down the overlay
      if (this.app && typeof this.app.toggleAnnotation === "function") {
        this.app.toggleAnnotation();
      } else {
        this.deactivate(false);
      }
    };
    this.closeBtn?.addEventListener("click", this.closeBtn._clickHandler);
  }

  setupKeyboardShortcuts() {
    this.keydownHandler = (e) => {
      if (!this.isActive) return;

      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")
        return;

      const key = e.key.toLowerCase();

      if (key === "p") {
        this.setTool("pen");
      } else if (key === "h") {
        this.setTool("highlighter");
      } else if (key === "a") {
        this.setTool("arrow");
      } else if (key === "r") {
        this.setTool("rectangle");
      } else if (key === "e") {
        this.setTool("ellipse");
      } else if (key === "t") {
        this.setTool("text");
      } else if (key === "c") {
        this.clearAll();
      } else if (e.ctrlKey && key === "z") {
        e.preventDefault();
        this.undo();
      } else if (key === "escape") {
        this.deactivate(false);
      }
    };
    document.addEventListener("keydown", this.keydownHandler);
  }

  setTool(tool) {
    this.currentTool = tool;
    this.toolBtns.forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tool === tool);
    });
    if (window.electronAPI?.sendOverlaySettings) {
      window.electronAPI.sendOverlaySettings({ tool: this.currentTool });
    }
  }

  handleOverlayAction(action) {
    // If we're not active, don't draw anything locally
    if (!this.isActive) return;

    // Simulate mouse events from overlay data
    const e = { clientX: action.x, clientY: action.y };

    if (action.type === "mousedown") {
      this.currentTool = action.tool || this.currentTool;
      this.currentColor = action.color || this.currentColor;
      this.strokeWidth = action.width || this.strokeWidth;
      this.startDrawing(e);
    } else if (action.type === "mousemove") {
      this.draw(e);
    } else if (action.type === "mouseup") {
      this.stopDrawing(e);
    } else if (action.type === "textCommand") {
      this.ctx.font = action.font || "bold 24px sans-serif";
      this.ctx.fillStyle = action.color || this.currentColor;
      const maxW = action.maxWidth || this.canvas.width;
      this.wrapText(this.ctx, action.text, action.x, action.y, maxW, 29);
      this.saveToHistory({
        type: "text",
        text: action.text,
        x: action.x,
        y: action.y,
        color: action.color || this.currentColor,
        font: action.font || "bold 24px sans-serif",
        maxWidth: maxW,
      });
    }
  }

  setDrawingResolution(width, height) {
    this.canvas.width = width;
    this.canvas.height = height;
    this.tempCanvas.width = width;
    this.tempCanvas.height = height;
    this.redrawHistory();
  }

  activate(isActiveOverlay = false) {
    if (this.isActive) return;

    this.isActive = true;
    this.isActiveOverlay = isActiveOverlay;
    this.toolbar.classList.remove("hidden");

    // Only show local canvases if we are NOT in overlay mode
    if (!isActiveOverlay) {
      this.canvas.classList.add("active");
      this.tempCanvas.classList.add("active");
    }

    this.app.showToast(isActiveOverlay ? "Screen Annotation Active" : "Local Annotation Active", "info");
  }

  deactivate(clearContent = false) {
    if (!this.isActive) return;

    this.isActive = false;
    this.toolbar.classList.add("hidden");
    this.canvas.classList.remove("active");
    this.tempCanvas.classList.remove("active");
    this.isActiveOverlay = false;

    if (this.textInput) {
      this.textInput.remove();
      this.textInput = null;
    }

    if (clearContent) {
      this.clearAll();
    }
  }

  startDrawing(e) {
    if (!this.isActive) return;

    if (this.currentTool === "text") {
      this.addText(e.clientX, e.clientY);
      return;
    }

    this.isDrawing = true;
    this.startX = e.clientX;
    this.startY = e.clientY;
    this.currentPath = [
      {
        x: this.startX,
        y: this.startY,
      },
    ];

    this.tempCtx.strokeStyle = this.currentColor;
    this.tempCtx.lineWidth =
      this.currentTool === "highlighter" ? 20 : this.strokeWidth;
    this.tempCtx.globalAlpha = this.currentTool === "highlighter" ? 0.4 : 1;
  }

  draw(e) {
    if (!this.isDrawing || !this.isActive) return;

    const x = e.clientX;
    const y = e.clientY;

    this.tempCtx.clearRect(0, 0, this.tempCanvas.width, this.tempCanvas.height);
    this.redrawHistory();

    this.tempCtx.strokeStyle = this.currentColor;
    this.tempCtx.lineWidth =
      this.currentTool === "highlighter" ? 20 : this.strokeWidth;
    this.tempCtx.globalAlpha = this.currentTool === "highlighter" ? 0.4 : 1;

    if (this.currentTool === "pen" || this.currentTool === "highlighter") {
      this.currentPath.push({ x, y });
      this.tempCtx.beginPath();
      this.tempCtx.moveTo(this.currentPath[0].x, this.currentPath[0].y);
      for (let i = 1; i < this.currentPath.length; i++) {
        this.tempCtx.lineTo(this.currentPath[i].x, this.currentPath[i].y);
      }
      this.tempCtx.stroke();
    } else if (this.currentTool === "arrow") {
      this.drawArrow(this.tempCtx, this.startX, this.startY, x, y);
    } else if (this.currentTool === "rectangle") {
      this.tempCtx.strokeRect(
        this.startX,
        this.startY,
        x - this.startX,
        y - this.startY,
      );
    } else if (this.currentTool === "ellipse") {
      this.drawEllipse(
        this.tempCtx,
        this.startX,
        this.startY,
        x - this.startX,
        y - this.startY,
      );
    }
  }

  stopDrawing(e) {
    if (!this.isDrawing || !this.isActive) return;

    const endX = e ? e.clientX : this.startX;
    const endY = e ? e.clientY : this.startY;

    this.tempCtx.clearRect(0, 0, this.tempCanvas.width, this.tempCanvas.height);
    this.redrawHistory();

    this.ctx.strokeStyle = this.currentColor;
    this.ctx.lineWidth =
      this.currentTool === "highlighter" ? 20 : this.strokeWidth;
    this.ctx.globalAlpha = this.currentTool === "highlighter" ? 0.4 : 1;

    if (this.currentTool === "pen" || this.currentTool === "highlighter") {
      this.ctx.beginPath();
      this.ctx.moveTo(this.currentPath[0].x, this.currentPath[0].y);
      for (let i = 1; i < this.currentPath.length; i++) {
        this.ctx.lineTo(this.currentPath[i].x, this.currentPath[i].y);
      }
      this.ctx.stroke();

      this.saveToHistory({
        type: this.currentTool,
        path: [...this.currentPath],
        color: this.currentColor,
        strokeWidth: this.strokeWidth,
        alpha: this.currentTool === "highlighter" ? 0.4 : 1,
      });
    } else if (this.currentTool === "arrow") {
      this.drawArrow(this.ctx, this.startX, this.startY, endX, endY);
      this.saveToHistory({
        type: "arrow",
        startX: this.startX,
        startY: this.startY,
        endX: endX,
        endY: endY,
        color: this.currentColor,
        strokeWidth: this.strokeWidth,
      });
    } else if (this.currentTool === "rectangle") {
      this.ctx.strokeRect(
        this.startX,
        this.startY,
        endX - this.startX,
        endY - this.startY,
      );
      this.saveToHistory({
        type: "rectangle",
        x: this.startX,
        y: this.startY,
        width: endX - this.startX,
        height: endY - this.startY,
        color: this.currentColor,
        strokeWidth: this.strokeWidth,
      });
    } else if (this.currentTool === "ellipse") {
      this.drawEllipse(
        this.ctx,
        this.startX,
        this.startY,
        endX - this.startX,
        endY - this.startY,
      );
      this.saveToHistory({
        type: "ellipse",
        x: this.startX,
        y: this.startY,
        width: endX - this.startX,
        height: endY - this.startY,
        color: this.currentColor,
        strokeWidth: this.strokeWidth,
      });
    }

    this.isDrawing = false;
    this.currentPath = [];
  }

  drawArrow(ctx, fromX, fromY, toX, toY) {
    const headLength = 15;
    const angle = Math.atan2(toY - fromY, toX - fromX);

    ctx.beginPath();
    ctx.moveTo(fromX, fromY);
    ctx.lineTo(toX, toY);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(toX, toY);
    ctx.lineTo(
      toX - headLength * Math.cos(angle - Math.PI / 6),
      toY - headLength * Math.sin(angle - Math.PI / 6),
    );
    ctx.moveTo(toX, toY);
    ctx.lineTo(
      toX - headLength * Math.cos(angle + Math.PI / 6),
      toY - headLength * Math.sin(angle + Math.PI / 6),
    );
    ctx.stroke();
  }

  drawEllipse(ctx, x, y, width, height) {
    ctx.beginPath();
    ctx.ellipse(
      x + width / 2,
      y + height / 2,
      Math.abs(width / 2),
      Math.abs(height / 2),
      0,
      0,
      2 * Math.PI,
    );
    ctx.stroke();
  }

  addText(x, y) {
    const existingInput = document.querySelector(".annotation-text-input");
    if (existingInput) {
      this.commitText(existingInput);
    }

    const input = document.createElement("input");
    input.type = "text";
    input.className = "annotation-text-input";
    input.style.left = x + "px";
    input.style.top = y + "px";
    input.style.borderColor = this.currentColor;
    input.style.color = this.currentColor;
    document.body.appendChild(input);

    setTimeout(() => {
      input.focus();
      this.textInput = input;
    }, 10);

    input.addEventListener("blur", () => {
      setTimeout(() => this.commitText(input), 100);
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.commitText(input);
      } else if (e.key === "Escape") {
        input.remove();
        this.textInput = null;
      }
    });
  }

  commitText(input) {
    const text = input.value.trim();
    if (text) {
      const x = parseInt(input.style.left);
      const y = parseInt(input.style.top);

      this.ctx.font = "bold 24px sans-serif";
      this.ctx.fillStyle = this.currentColor;
      this.ctx.fillText(text, x + 10, y + 30);

      this.saveToHistory({
        type: "text",
        text: text,
        x: x + 10,
        y: y + 30,
        color: this.currentColor,
        font: "bold 24px sans-serif",
      });
    }
    input.remove();
    this.textInput = null;
  }

  saveToHistory(action) {
    this.history = this.history.slice(0, this.historyIndex + 1);
    this.history.push(action);
    this.historyIndex++;
  }

  undo() {
    if (this.historyIndex < 0) return;

    this.history.pop();
    this.historyIndex--;
    this.redrawHistory();

    if (this.isActiveOverlay && window.electronAPI?.sendOverlayCommand) {
      window.electronAPI.sendOverlayCommand("undo");
    }
  }

  clearAll() {
    this.history = [];
    this.historyIndex = -1;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.tempCtx.clearRect(0, 0, this.tempCanvas.width, this.tempCanvas.height);

    if (this.isActiveOverlay && window.electronAPI?.sendOverlayCommand) {
      window.electronAPI.sendOverlayCommand("clear");
    }
  }

  redrawHistory() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    for (const action of this.history) {
      this.ctx.strokeStyle = action.color;
      this.ctx.fillStyle = action.color;
      this.ctx.lineWidth = action.strokeWidth || this.strokeWidth;
      this.ctx.globalAlpha = action.alpha || 1;
      this.ctx.lineCap = "round";
      this.ctx.lineJoin = "round";

      if (action.type === "pen" || action.type === "highlighter") {
        if (action.path && action.path.length > 0) {
          this.ctx.beginPath();
          this.ctx.moveTo(action.path[0].x, action.path[0].y);
          for (let i = 1; i < action.path.length; i++) {
            this.ctx.lineTo(action.path[i].x, action.path[i].y);
          }
          this.ctx.stroke();
        }
      } else if (action.type === "arrow") {
        this.drawArrow(
          this.ctx,
          action.startX,
          action.startY,
          action.endX,
          action.endY,
        );
      } else if (action.type === "rectangle") {
        this.ctx.strokeRect(action.x, action.y, action.width, action.height);
      } else if (action.type === "ellipse") {
        this.drawEllipse(
          this.ctx,
          action.x,
          action.y,
          action.width,
          action.height,
        );
      } else if (action.type === "text") {
        this.ctx.font = action.font;
        this.wrapText(this.ctx, action.text, action.x, action.y, action.maxWidth || this.canvas.width, 29);
      }
    }

    this.ctx.globalAlpha = 1;
  }

  wrapText(context, text, x, y, maxWidth, lineHeight) {
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

  getCanvas() {
    return this.canvas;
  }

  getTempCanvas() {
    return this.tempCanvas;
  }

  destroy() {
    this.deactivate();

    // Remove all event listeners
    if (this.canvas) {
      this.canvas.removeEventListener("mousedown", this.canvasMousedownHandler);
      this.canvas.removeEventListener("mousemove", this.canvasMousemoveHandler);
      this.canvas.removeEventListener("mouseup", this.canvasMouseupHandler);
      this.canvas.removeEventListener(
        "mouseleave",
        this.canvasMouseleaveHandler,
      );
      this.canvas.removeEventListener(
        "touchstart",
        this.canvasTouchstartHandler,
      );
      this.canvas.removeEventListener("touchmove", this.canvasTouchmoveHandler);
      this.canvas.removeEventListener("touchend", this.canvasTouchendHandler);
      this.canvas.remove();
    }

    if (this.tempCanvas) {
      this.tempCanvas.remove();
    }

    if (window.__resizeHandler) {
      window.removeEventListener("resize", window.__resizeHandler);
      delete window.__resizeHandler;
    }

    if (this.keydownHandler) {
      document.removeEventListener("keydown", this.keydownHandler);
      this.keydownHandler = null;
    }

    // Clean up toolbar listeners
    if (this.toolBtns) {
      this.toolBtns.forEach((btn) => {
        if (btn._selectHandler) {
          btn.removeEventListener("click", btn._selectHandler);
          delete btn._selectHandler;
        }
      });
    }

    if (this.colorBtns) {
      this.colorBtns.forEach((btn) => {
        if (btn._selectHandler) {
          btn.removeEventListener("click", btn._selectHandler);
          delete btn._selectHandler;
        }
      });
    }

    if (this.undoBtn && this.undoBtn._clickHandler) {
      this.undoBtn.removeEventListener("click", this.undoBtn._clickHandler);
      delete this.undoBtn._clickHandler;
    }

    if (this.clearBtn && this.clearBtn._clickHandler) {
      this.clearBtn.removeEventListener("click", this.clearBtn._clickHandler);
      delete this.clearBtn._clickHandler;
    }

    if (this.closeBtn && this.closeBtn._clickHandler) {
      this.closeBtn.removeEventListener("click", this.closeBtn._clickHandler);
      delete this.closeBtn._clickHandler;
    }

    // Clear references
    this.canvas = null;
    this.ctx = null;
    this.tempCanvas = null;
    this.tempCtx = null;
    this.toolbar = null;
    this.toolBtns = null;
    this.colorBtns = null;
    this.undoBtn = null;
    this.clearBtn = null;
    this.closeBtn = null;
  }
}

window.AnnotationManager = AnnotationManager;
