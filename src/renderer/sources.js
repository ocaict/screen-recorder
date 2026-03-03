class SourceManager {
  constructor(app) {
    this.app = app;
    this.sourceHandlers = []; // Track handlers for cleanup
  }

  async openSourceModal() {
    try {
      this.app.sourceGrid.innerHTML =
        '<div class="loading">Loading sources...</div>';
      this.app.openModal(this.app.sourceModal);

      const sources = await window.electronAPI.getCaptureSources();
      this.displaySources(sources);
    } catch (err) {
      this.app.showToast("Failed to get sources", "error");
      console.error(err);
    }
  }

  displaySources(sources) {
    // Clean up old handlers
    this.sourceHandlers.forEach(({ element, handlers }) => {
      handlers.forEach(({ event, handler }) => {
        element.removeEventListener(event, handler);
      });
    });
    this.sourceHandlers = [];

    this.app.sourceGrid.innerHTML = "";

    if (sources.length === 0) {
      this.app.sourceGrid.innerHTML =
        '<div class="no-sources">No sources available</div>';
      return;
    }

    sources.forEach((source) => {
      const item = document.createElement("div");
      item.className = "source-grid-item";
      item.dataset.id = source.id;
      item.setAttribute("role", "button");
      item.setAttribute("tabindex", "0");
      item.setAttribute("aria-label", `Select ${source.name}`);

      const img = document.createElement("img");
      img.src = source.thumbnail;
      img.alt = source.name;
      img.loading = "lazy";
      img.decoding = "async";

      const label = document.createElement("div");
      label.className = "source-label";
      label.textContent = source.name;

      item.appendChild(img);
      item.appendChild(label);

      const selectSourceHandler = () => this.selectSource(source, item);
      const keydownHandler = (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          selectSourceHandler(e);
        }
      };

      item.addEventListener("click", selectSourceHandler);
      item.addEventListener("keydown", keydownHandler);

      // Track handlers for cleanup
      this.sourceHandlers.push({
        element: item,
        handlers: [
          { event: "click", handler: selectSourceHandler },
          { event: "keydown", handler: keydownHandler },
        ],
      });

      this.app.sourceGrid.appendChild(item);
    });
  }

  async selectSource(source, element) {
    document
      .querySelectorAll(".source-grid-item")
      .forEach((el) => el.classList.remove("selected"));
    element.classList.add("selected");

    if (this.app.cropDrawId) {
      cancelAnimationFrame(this.app.cropDrawId);
      this.app.cropDrawId = null;
    }
    if (this.app.currentPreviewStream) {
      this.app.currentPreviewStream.getTracks().forEach((t) => t.stop());
      this.app.currentPreviewStream = null;
    }
    this.app.currentCropCanvas = null;

    this.app.recordingManager.selectedSource = source;
    this.app.recordingManager.selectedRegion = null;
    if (window.electronAPI.hideRegionIndicator) {
      window.electronAPI.hideRegionIndicator();
    }
    
    this.app.closeModal(this.app.sourceModal);
    this.app.startBtn.disabled = false;
    document
      .querySelectorAll(".timer-preset")
      .forEach((btn) => (btn.disabled = false));
    
    await this.app.recordingManager.setupVideoStream(source);
    this.updateSourcePreview(source);
    this.app.updateQuickSettings();
    this.app.showQuickSettings();
  }

  updateSourcePreview(source) {
    const sourceList = document.getElementById("sourceList");
    sourceList.innerHTML = `
      <div class="source-item active">
        <img src="${source.thumbnail}" alt="${source.name}" class="source-thumbnail">
        <span class="source-name">${source.name}</span>
      </div>
    `;
  }

  destroy() {
    // Clean up all tracked event listeners
    this.sourceHandlers.forEach(({ element, handlers }) => {
      handlers.forEach(({ event, handler }) => {
        element.removeEventListener(event, handler);
      });
    });
    this.sourceHandlers = [];
  }
}

window.SourceManager = SourceManager;
