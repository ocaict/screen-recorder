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
    this.maxHistorySize = 100;
    this.currentPath = [];
    this.textInput = null;
    this.stepCounter = 1;
    this.dirty = false;

    this.canvas = null;
    this.ctx = null;
    this.tempCanvas = null;
    this.tempCtx = null;
  }

  init() {
    this.createCanvas();
    this.setupPaletteSync();
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

    // Store resize handler on the instance so it can be properly cleaned up later
    this.resizeHandler = () => {
      this.canvas.width = window.innerWidth;
      this.canvas.height = window.innerHeight;
      this.tempCanvas.width = window.innerWidth;
      this.tempCanvas.height = window.innerHeight;
      this.redrawHistory();
    };
    window.addEventListener("resize", this.resizeHandler);

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

    // { passive: false } is required because the handlers call e.preventDefault()
    // to block scroll/zoom while drawing. Omitting this causes a browser violation warning.
    this.canvas.addEventListener("touchstart", this.canvasTouchstartHandler, { passive: false });
    this.canvas.addEventListener("touchmove", this.canvasTouchmoveHandler, { passive: false });
    this.canvas.addEventListener("touchend", this.canvasTouchendHandler, { passive: true });
  }

  setupPaletteSync() {
    // Listen for updates from the Palette window
    if (window.electronAPI?.onAnnotationPaletteSettings) {
      window.electronAPI.onAnnotationPaletteSettings((settings) => {
        if (settings.tool) this.updateToolUI(settings.tool);
        if (settings.color) this.updateColorUI(settings.color);
      });
    }
  }

  updateToolUI(tool) {
    this.currentTool = tool;
  }

  updateColorUI(color) {
    this.currentColor = color;
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
      } else if (key === "l") {
        this.setTool("laser");
      } else if (key === "r") {
        this.setTool("rectangle");
      } else if (key === "e") {
        this.setTool("ellipse");
      } else if (key === "t") {
        this.setTool("text");
      } else if (key === "x") {
        this.setTool("eraser");
      } else if (key === "s") {
        this.setTool("step");
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
    if (tool === "step" && this.currentTool !== "step") {
      this.stepCounter = 1;
    }
    this.currentTool = tool;
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
      if (action.tool === "step" && this.currentTool !== "step") {
        this.stepCounter = 1;
      }
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
    } else if (action.type === "eraseItem") {
      this.history.splice(action.index, 1);
      this.historyIndex--;
      // Recalculate step counter so next placed Step follows correct numbering
      this.stepCounter = this.history.filter(h => h.type === "step").length + 1;
      this.redrawHistory();
    }
  }

  setDrawingResolution(width, height) {
    this.canvas.width = width;
    this.canvas.height = height;
    this.tempCanvas.width = width;
    this.tempCanvas.height = height;
    this.redrawHistory();
  }

  activate(showToolbar = true) {
    if (this.isActive) return;
    this.isActive = true;
    this.isActiveOverlay = true;

    // Show the floating palette instead of the inline toolbar
    if (window.electronAPI?.toggleAnnotationPalette) {
      window.electronAPI.toggleAnnotationPalette(true);
    } else if (showToolbar && this.toolbar) {
      // Fallback to inline if API missing (safety)
      this.toolbar.classList.remove("hidden");
    }

    if (this.app) {
      this.app.overlayAnnotationActive = true;
    }
  }

  deactivate(hideToolbar = true) {
    this.isActive = false;

    // Hide the floating palette
    if (window.electronAPI?.toggleAnnotationPalette) {
      window.electronAPI.toggleAnnotationPalette(false);
    } else if (hideToolbar && this.toolbar) {
      this.toolbar.classList.add("hidden");
    }

    this.canvas.classList.remove("active");
    this.tempCanvas.classList.remove("active");
    this.isActiveOverlay = false;

    if (this.textInput) {
      this.textInput.remove();
      this.textInput = null;
    }

    if (this.app) {
      this.app.overlayAnnotationActive = false;
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

    if (this.currentTool === "eraser") {
      this.hitTestAndErase(this.startX, this.startY);
      return;
    }

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

    if (this.currentTool === "step") {
      this.drawStep(
        this.tempCtx,
        this.startX,
        this.startY,
        this.stepCounter,
        this.currentColor,
        this.strokeWidth,
      );
    }
  }

  draw(e) {
    if (!this.isDrawing || !this.isActive) return;

    const x = e.clientX;
    const y = e.clientY;

    if (this.currentTool === "eraser") {
      this.hitTestAndErase(x, y);
      return;
    }

    this.tempCtx.clearRect(0, 0, this.tempCanvas.width, this.tempCanvas.height);
    // REMOVED: redrawHistory() here was causing performance lag

    this.tempCtx.strokeStyle = this.currentColor;
    this.tempCtx.lineWidth =
      this.currentTool === "highlighter" ? 20 : this.strokeWidth;
    this.tempCtx.globalAlpha = this.currentTool === "highlighter" ? 0.4 : 1;

    if (this.currentTool === "pen" || this.currentTool === "highlighter") {
      this.currentPath.push({ x, y });
      this.tempCtx.beginPath();
      if (this.currentPath.length < 3) {
        this.tempCtx.moveTo(this.currentPath[0].x, this.currentPath[0].y);
        this.tempCtx.lineTo(x, y);
      } else {
        this.tempCtx.moveTo(this.currentPath[0].x, this.currentPath[0].y);
        let i;
        for (i = 1; i < this.currentPath.length - 2; i++) {
          const xc = (this.currentPath[i].x + this.currentPath[i + 1].x) / 2;
          const yc = (this.currentPath[i].y + this.currentPath[i + 1].y) / 2;
          this.tempCtx.quadraticCurveTo(this.currentPath[i].x, this.currentPath[i].y, xc, yc);
        }
        this.tempCtx.quadraticCurveTo(this.currentPath[i].x, this.currentPath[i].y, this.currentPath[i + 1].x, this.currentPath[i + 1].y);
      }
      this.tempCtx.stroke();
    } else if (this.currentTool === "laser") {
      // Laser logic is handled entirely by the overlay
    } else if (this.currentTool === "arrow") {
      this.drawArrow(this.tempCtx, this.startX, this.startY, x, y, false);
    } else if (this.currentTool === "double-arrow") {
      this.drawArrow(this.tempCtx, this.startX, this.startY, x, y, true);
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
    } else if (this.currentTool === "step") {
      this.drawStep(
        this.tempCtx,
        x,
        y,
        this.stepCounter,
        this.currentColor,
        this.strokeWidth,
      );
    }
  }

  stopDrawing(e) {
    if (!this.isDrawing || !this.isActive) return;

    const endX = e ? e.clientX : this.startX;
    const endY = e ? e.clientY : this.startY;

    if (this.currentTool === "eraser") {
      this.isDrawing = false;
      return;
    }

    this.tempCtx.clearRect(0, 0, this.tempCanvas.width, this.tempCanvas.height);
    this.redrawHistory();

    this.ctx.strokeStyle = this.currentColor;
    this.ctx.lineWidth =
      this.currentTool === "highlighter" ? 20 : this.strokeWidth;
    this.ctx.globalAlpha = this.currentTool === "highlighter" ? 0.4 : 1;

    if (this.currentTool === "pen" || this.currentTool === "highlighter") {
      this.ctx.beginPath();
      if (this.currentPath.length < 3) {
        this.ctx.moveTo(this.currentPath[0].x, this.currentPath[0].y);
        this.ctx.lineTo(endX, endY);
      } else {
        this.ctx.moveTo(this.currentPath[0].x, this.currentPath[0].y);
        let i;
        for (i = 1; i < this.currentPath.length - 2; i++) {
          const xc = (this.currentPath[i].x + this.currentPath[i + 1].x) / 2;
          const yc = (this.currentPath[i].y + this.currentPath[i + 1].y) / 2;
          this.ctx.quadraticCurveTo(this.currentPath[i].x, this.currentPath[i].y, xc, yc);
        }
        this.ctx.quadraticCurveTo(this.currentPath[i].x, this.currentPath[i].y, this.currentPath[i + 1].x, this.currentPath[i + 1].y);
      }
      this.ctx.stroke();

      this.saveToHistory({
        type: this.currentTool,
        path: [...this.currentPath],
        color: this.currentColor,
        strokeWidth: this.strokeWidth,
        alpha: this.currentTool === "highlighter" ? 0.4 : 1,
      });
    } else if (this.currentTool === "laser") {
      // Laser never saves to history
    } else if (this.currentTool === "arrow") {
      this.drawArrow(this.ctx, this.startX, this.startY, endX, endY, false);
      this.saveToHistory({
        type: "arrow",
        startX: this.startX,
        startY: this.startY,
        endX: endX,
        endY: endY,
        color: this.currentColor,
        strokeWidth: this.strokeWidth,
      });
    } else if (this.currentTool === "double-arrow") {
      this.drawArrow(this.ctx, this.startX, this.startY, endX, endY, true);
      this.saveToHistory({
        type: "double-arrow",
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
    } else if (this.currentTool === "step") {
      this.drawStep(
        this.ctx,
        endX,
        endY,
        this.stepCounter,
        this.currentColor,
        this.strokeWidth,
      );
      this.saveToHistory({
        type: "step",
        x: endX,
        y: endY,
        color: this.currentColor,
        strokeWidth: this.strokeWidth,
        stepNumber: this.stepCounter,
      });
      this.stepCounter++;
    }

    this.isDrawing = false;
    this.currentPath = [];
  }

  hitTestAndErase(x, y) {
    if (this.historyIndex < 0) return false;

    let erased = false;
    for (let h = this.historyIndex; h >= 0; h--) {
      const a = this.history[h];
      this.tempCtx.beginPath();

      const testWidth = Math.max((a.strokeWidth || this.strokeWidth) + 15, 25);
      this.tempCtx.lineWidth = testWidth;
      this.tempCtx.lineCap = "round";
      this.tempCtx.lineJoin = "round";

      let hit = false;
      if (a.type === "pen" || a.type === "highlighter") {
        if (a.path.length < 3) {
          if (a.path.length > 0) {
            this.tempCtx.moveTo(a.path[0].x, a.path[0].y);
            if (a.path.length > 1) {
              this.tempCtx.lineTo(a.path[a.path.length - 1].x, a.path[a.path.length - 1].y);
            }
          }
        } else {
          this.tempCtx.moveTo(a.path[0].x, a.path[0].y);
          let i;
          for (i = 1; i < a.path.length - 2; i++) {
            const xc = (a.path[i].x + a.path[i + 1].x) / 2;
            const yc = (a.path[i].y + a.path[i + 1].y) / 2;
            this.tempCtx.quadraticCurveTo(a.path[i].x, a.path[i].y, xc, yc);
          }
          this.tempCtx.quadraticCurveTo(a.path[i].x, a.path[i].y, a.path[i + 1].x, a.path[i + 1].y);
        }
        hit = this.tempCtx.isPointInStroke(x, y);
      } else if (a.type === "arrow") {
        this.drawArrow(this.tempCtx, a.startX, a.startY, a.endX, a.endY, false, false);
        hit = this.tempCtx.isPointInStroke(x, y);
      } else if (a.type === "double-arrow") {
        this.drawArrow(this.tempCtx, a.startX, a.startY, a.endX, a.endY, true, false);
        hit = this.tempCtx.isPointInStroke(x, y);
      } else if (a.type === "rectangle") {
        this.tempCtx.rect(a.x, a.y, a.width, a.height);
        hit = this.tempCtx.isPointInStroke(x, y);
      } else if (a.type === "ellipse") {
        this.tempCtx.ellipse(a.x + a.width / 2, a.y + a.height / 2, Math.abs(a.width / 2), Math.abs(a.height / 2), 0, 0, 2 * Math.PI);
        hit = this.tempCtx.isPointInStroke(x, y);
      } else if (a.type === "step") {
        const radius = 18 + ((a.strokeWidth || this.strokeWidth) * 1.5);
        this.tempCtx.arc(a.x, a.y, radius, 0, Math.PI * 2);
        hit = this.tempCtx.isPointInPath(x, y);
      } else if (a.type === "text") {
        this.tempCtx.rect(a.x, a.y - 30, a.maxWidth || this.canvas.width, 40);
        hit = this.tempCtx.isPointInPath(x, y); // fill hit
      }

      if (hit) {
        this.history.splice(h, 1);
        this.historyIndex--;
        erased = true;
        break;
      }
    }

    if (erased) {
      this.redrawHistory();
    }
    return erased;
  }

  drawArrow(ctx, fromX, fromY, toX, toY, isDoubleHeaded = false, doStroke = true) {
    const headLength = 20; // Improved arrow head visibility
    const angle = Math.atan2(toY - fromY, toX - fromX);

    ctx.beginPath();

    if (isDoubleHeaded) {
      ctx.moveTo(fromX + headLength * Math.cos(angle + Math.PI / 6), fromY + headLength * Math.sin(angle + Math.PI / 6));
      ctx.lineTo(fromX, fromY);
      ctx.lineTo(fromX + headLength * Math.cos(angle - Math.PI / 6), fromY + headLength * Math.sin(angle - Math.PI / 6));
      ctx.moveTo(fromX, fromY);
    } else {
      ctx.moveTo(fromX, fromY);
    }

    ctx.lineTo(toX, toY);

    // Draw the arrow head as a single continuous path from the tip
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

  drawStep(ctx, x, y, number, color, width) {
    const radius = 18 + (width * 1.5);
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = color === "#ffffff" ? "#000000" : "#ffffff";
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = color === "#ffffff" ? "#000000" : "#ffffff";
    ctx.font = `bold ${radius}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(number.toString(), x, y + (radius * 0.1));
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
    if (this.history.length >= this.maxHistorySize) {
      this.history.shift();
      this.historyIndex--;
    }
    this.history = this.history.slice(0, this.historyIndex + 1);
    this.history.push(action);
    this.historyIndex++;
    this.dirty = true;
  }

  undo() {
    if (this.historyIndex < 0) return;

    // Truncate history to current index so future draws don't re-apply undone items
    this.history = this.history.slice(0, this.historyIndex);
    this.historyIndex--;
    this.redrawHistory();
    this.dirty = true;

    if (this.isActiveOverlay && window.electronAPI?.sendOverlayCommand) {
      window.electronAPI.sendOverlayCommand("undo");
    }
  }

  /**
   * Destroy this instance: remove all DOM elements and event listeners.
   * Call this before creating a new AnnotationManager on the same page.
   */
  destroy() {
    // Remove resize listener (stored on instance, not window global)
    if (this.resizeHandler) {
      window.removeEventListener("resize", this.resizeHandler);
      this.resizeHandler = null;
    }

    // Remove keyboard listener
    if (this.keydownHandler) {
      document.removeEventListener("keydown", this.keydownHandler);
      this.keydownHandler = null;
    }

    // Remove canvas event listeners and DOM nodes
    if (this.canvas) {
      this.canvas.removeEventListener("mousedown", this.canvasMousedownHandler);
      this.canvas.removeEventListener("mousemove", this.canvasMousemoveHandler);
      this.canvas.removeEventListener("mouseup", this.canvasMouseupHandler);
      this.canvas.removeEventListener("mouseleave", this.canvasMouseleaveHandler);
      this.canvas.removeEventListener("touchstart", this.canvasTouchstartHandler, { passive: false });
      this.canvas.removeEventListener("touchmove", this.canvasTouchmoveHandler, { passive: false });
      this.canvas.removeEventListener("touchend", this.canvasTouchendHandler, { passive: true });
      this.canvas.remove();
      this.canvas = null;
    }

    if (this.tempCanvas) {
      this.tempCanvas.remove();
      this.tempCanvas = null;
    }

    if (this.textInput) {
      this.textInput.remove();
      this.textInput = null;
    }

    this.history = [];
    this.historyIndex = -1;
  }

  clearAll() {
    this.history = [];
    this.historyIndex = -1;
    this.stepCounter = 1;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.tempCtx.clearRect(0, 0, this.tempCanvas.width, this.tempCanvas.height);
    this.dirty = true;

    if (this.isActiveOverlay && window.electronAPI?.sendOverlayCommand) {
      window.electronAPI.sendOverlayCommand("clear");
    }
  }

  redrawHistory() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.dirty = true;

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
          if (action.path.length < 3) {
            if (action.path.length > 0) {
              this.ctx.moveTo(action.path[0].x, action.path[0].y);
              if (action.path.length > 1) {
                this.ctx.lineTo(action.path[action.path.length - 1].x, action.path[action.path.length - 1].y);
              }
            }
          } else {
            this.ctx.moveTo(action.path[0].x, action.path[0].y);
            let i;
            for (i = 1; i < action.path.length - 2; i++) {
              const xc = (action.path[i].x + action.path[i + 1].x) / 2;
              const yc = (action.path[i].y + action.path[i + 1].y) / 2;
              this.ctx.quadraticCurveTo(action.path[i].x, action.path[i].y, xc, yc);
            }
            this.ctx.quadraticCurveTo(action.path[i].x, action.path[i].y, action.path[i + 1].x, action.path[i + 1].y);
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
          false
        );
      } else if (action.type === "double-arrow") {
        this.drawArrow(
          this.ctx,
          action.startX,
          action.startY,
          action.endX,
          action.endY,
          true
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
      } else if (action.type === "step") {
        this.drawStep(
          this.ctx,
          action.x,
          action.y,
          action.stepNumber,
          action.color,
          action.strokeWidth || this.strokeWidth
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

  checkAndResetDirty() {
    if (this.dirty) {
      this.dirty = false;
      return true;
    }
    return false;
  }

}

window.AnnotationManager = AnnotationManager;
