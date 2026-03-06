class RecentRecordingsManager {
  constructor(app) {
    this.app = app;
  }

  async loadRecentRecordings() {
    try {
      const recordings = await window.electronAPI.getRecentRecordings();
      this.displayRecentRecordings(recordings);
    } catch (err) {
      console.error("Failed to load recent recordings:", err);
    }
  }

  formatFileSize(bytes) {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  }

  displayRecentRecordings(recordings) {
    const container = this.app.recentRecordingsList;
    if (!container) return;

    if (!recordings || recordings.length === 0) {
      container.innerHTML = `<div class="no-recordings" role="status">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <polygon points="5,3 19,12 5,21" />
        </svg>
        <p class="no-recordings-text">No recordings yet</p>
        <p class="no-recordings-hint">Your recorded videos will appear here</p>
      </div>`;
      return;
    }

    const limitedRecordings = recordings.slice(0, 10);
    container.innerHTML = limitedRecordings.map((recording) => {
      const date = new Date(recording.recordedAt);
      const dateStr = date.toLocaleDateString() + " " + date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      const sizeStr = this.formatFileSize(recording.size);
      const isSelected = this.app.selectedPaths.has(recording.filePath);

      return `<div class="recent-recording-item ${isSelected ? "selected" : ""}" 
                role="listitem" data-path="${recording.filePath}" 
                title="${recording.filePath}" tabindex="0" 
                aria-label="${recording.fileName}, ${dateStr}, ${sizeStr}">
        <input type="checkbox" class="recording-checkbox" ${isSelected ? "checked" : ""} aria-hidden="true" tabindex="-1">
        <div class="recent-recording-thumb">
          ${recording.thumbnailPath
            ? `<img src="thumb://${recording.thumbnailPath}" class="recent-recording-img" alt="">`
            : `<svg class="recent-recording-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polygon points="5,3 19,12 5,21"/>
              </svg>`
          }
        </div>
        <div class="recent-recording-info">
          <div class="recent-recording-name">${recording.fileName}</div>
          <div class="recent-recording-meta">
            <span class="recent-recording-date">${dateStr}</span>
            <span class="recent-recording-divider">•</span>
            <span class="recent-recording-size">${sizeStr}</span>
          </div>
        </div>
        <div class="recent-recording-actions">
          <button class="btn-action btn-play" data-path="${recording.filePath}" title="Play" aria-label="Play ${recording.fileName}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5,3 19,12 5,21"/>
            </svg>
          </button>
          <button class="btn-action btn-trim" data-path="${recording.filePath}" title="Trim video" aria-label="Trim ${recording.fileName}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="6" cy="6" r="3"/><path d="M8.12 8.12 12 12"/><circle cx="6" cy="18" r="3"/><path d="M9.8 14.84 12 12"/><path d="M12 12 20 4"/><path d="M12 12 20 20"/>
            </svg>
          </button>
          <button class="btn-action btn-folder" data-path="${recording.filePath}" title="Open folder" aria-label="Open folder containing ${recording.fileName}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
            </svg>
          </button>
          <button class="btn-action btn-delete" data-path="${recording.filePath}" title="Delete" aria-label="Delete ${recording.fileName}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
          </button>
        </div>
      </div>`;
    }).join("");

    this.attachRecordingListeners();
  }

  attachRecordingListeners() {
    const container = this.app.recentRecordingsList;
    if (!container) return;

    container.querySelectorAll(".recent-recording-item").forEach((item) => {
      const handleRecordingClick = async (e) => {
        const filePath = item.dataset.path;

        if (this.app.selectionMode) {
          e.preventDefault();
          const checkbox = item.querySelector(".recording-checkbox");
          if (this.app.selectedPaths.has(filePath)) {
            this.app.selectedPaths.delete(filePath);
            item.classList.remove("selected");
            if (checkbox) checkbox.checked = false;
          } else {
            this.app.selectedPaths.add(filePath);
            item.classList.add("selected");
            if (checkbox) checkbox.checked = true;
          }

          const count = this.app.selectedPaths.size;
          this.app.mergeRecordingsBtn.textContent = count > 0 ? `Merge (${count})` : "Merge";
          this.app.mergeRecordingsBtn.disabled = count < 2;
          return;
        }

        if (e.target.closest(".btn-action")) return;
        try {
          await window.electronAPI.openFile(filePath);
        } catch (err) {
          console.error("Failed to open recording:", err);
          this.app.showToast("Failed to open recording", "error");
        }
      };

      item.addEventListener("click", handleRecordingClick);
      item.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleRecordingClick(e);
        }
      });
    });

    container.querySelectorAll(".btn-play").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        try {
          await window.electronAPI.openFile(btn.dataset.path);
        } catch (err) {
          console.error("Failed to open file:", err);
          this.app.showToast("Failed to open file", "error");
        }
      });
    });

    container.querySelectorAll(".btn-folder").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        try {
          await window.electronAPI.openFileLocation(btn.dataset.path);
        } catch (err) {
          console.error("Failed to open folder:", err);
          this.app.showToast("Failed to open folder", "error");
        }
      });
    });

    container.querySelectorAll(".btn-delete").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const filePath = btn.dataset.path;
        if (confirm("Are you sure you want to delete this recording?")) {
          try {
            await window.electronAPI.deleteRecording(filePath);
            this.app.selectedPaths.delete(filePath);
            await this.loadRecentRecordings();
            this.app.showToast("Recording deleted", "success");
          } catch (err) {
            console.error("Failed to delete recording:", err);
            this.app.showToast("Failed to delete recording", "error");
          }
        }
      });
    });

    container.querySelectorAll(".btn-trim").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.app.openTrimModal(btn.dataset.path);
      });
    });
  }

  toggleSelectionMode() {
    this.app.selectionMode = !this.app.selectionMode;
    this.app.toggleSelectBtn.classList.toggle("active", this.app.selectionMode);
    this.app.mergeRecordingsBtn.style.display = this.app.selectionMode ? "inline-flex" : "none";

    if (!this.app.selectionMode) {
      this.app.selectedPaths.clear();
      this.app.recentRecordingsList.querySelectorAll(".recent-recording-item").forEach((item) => {
        item.classList.remove("selected");
        const checkbox = item.querySelector(".recording-checkbox");
        if (checkbox) checkbox.checked = false;
      });
      this.app.mergeRecordingsBtn.textContent = "Merge";
      this.app.mergeRecordingsBtn.disabled = true;
    }
  }

  async handleMerge() {
    const paths = Array.from(this.app.selectedPaths);
    if (paths.length < 2) {
      this.app.showToast("Select at least 2 recordings to merge", "error");
      return;
    }

    this.app.showToast("Merging recordings...", "info");

    try {
      const outputPath = await window.electronAPI.mergeVideos(paths);
      this.app.showToast("Videos merged successfully", "success");
      this.toggleSelectionMode();
      await this.loadRecentRecordings();

      if (confirm("Open merged video?")) {
        await window.electronAPI.openFile(outputPath);
      }
    } catch (err) {
      console.error("Failed to merge videos:", err);
      this.app.showToast("Failed to merge videos: " + err.message, "error");
    }
  }
}
