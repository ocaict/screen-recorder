/**
 * Floating Mini Controls - Script
 * This runs in the dedicated lightweight Mini Window
 */

class MiniControls {
    constructor() {
        this.timerEl = document.getElementById("miniTimer");
        this.pauseBtn = document.getElementById("miniPauseBtn");
        this.stopBtn = document.getElementById("miniStopBtn");
        this.discardBtn = document.getElementById("miniDiscardBtn");
        this.micBtn = document.getElementById("miniMicBtn");
        this.sysAudioBtn = document.getElementById("miniSysAudioBtn");
        this.webcamBtn = document.getElementById("miniWebcamBtn");
        this.drawBtn = document.getElementById("miniDrawBtn");
        this.presenterBtn = document.getElementById("miniPresenterBtn");
        this.closeBtn = document.getElementById("miniCloseBtn");
        this.collapseBtn = document.getElementById("miniCollapseBtn");
        this.toolbar = document.getElementById("miniToolbar");
        this.recordingStatus = document.getElementById("recordingStatus");
        this.statusLabel = document.getElementById("statusLabel");

        this.isPaused = false;
        this.isMicEnabled = true;
        this.isSysAudioEnabled = true;
        this.isWebcamEnabled = true;
        this.isDrawingActive = false;
        this.isCollapsed = false;

        this.init();
    }

    init() {
        // Button Event Listeners
        this.pauseBtn.addEventListener("click", () => this.togglePause());
        this.stopBtn.addEventListener("click", () => this.stopRecording());
        if (this.discardBtn) this.discardBtn.addEventListener("click", () => this.discardRecording());
        this.micBtn.addEventListener("click", () => this.toggleMic());
        this.sysAudioBtn.addEventListener("click", () => this.toggleSysAudio());
        this.webcamBtn.addEventListener("click", () => this.toggleWebcam());
        this.drawBtn.addEventListener("click", () => this.toggleDraw());
        this.presenterBtn.addEventListener("click", () => this.togglePresenter());
        this.closeBtn.addEventListener("click", () => this.hideMiniWindow());
        this.collapseBtn.addEventListener("click", () => this.toggleCollapse());

        // Enable dragging
        this.enableDrag();

        // Listen for state updates from the Main Process
        if (window.electronAPI) {
            window.electronAPI.onRecordingTimerUpdate((timeStr) => {
                this.timerEl.textContent = timeStr;
            });

            window.electronAPI.onRecordingStateUpdate((state) => {
                this.updateState(state);
            });

            window.electronAPI.onRecordingVolumeUpdate((volume) => {
                const meterBar = document.querySelector(".meter-bar");
                if (meterBar) {
                    // volume is 0.0 to 1.0
                    // We apply a slight boost and clamping for better visualization
                    const displayVol = Math.min(100, volume * 120);
                    meterBar.style.transform = `scaleX(${displayVol / 100})`;
                }
            });
        }

        // Keyboard Shortcuts (Local to Mini Window)
        window.addEventListener("keydown", (e) => {
            switch (e.key.toLowerCase()) {
                case "p": this.togglePause(); break;
                case "s": this.stopRecording(); break;
                case "delete": this.discardRecording(); break;
                case "m": this.toggleMic(); break;
                case "a": this.toggleSysAudio(); break;
                case "w": this.toggleWebcam(); break;
                case "d": this.toggleDraw(); break;
                case "c": this.togglePresenter(); break;
                case "f": this.toggleCollapse(); break;
                case "escape": this.hideMiniWindow(); break;
            }
        });

        console.log("Mini Controls Initialized");
    }

    updateState(state) {
        // Sync UI with the actual recording state provided by Main process
        this.isPaused = state.isPaused;
        this.isMicEnabled = state.recordAudio;
        this.isSysAudioEnabled = state.recordSystemAudio;
        this.isWebcamEnabled = state.webcamEnabled;

        // Update Icons & Pulse
        if (this.isPaused) {
            this.pauseIconToPlay();
            this.recordingStatus.classList.remove("pulse");
            this.statusLabel.textContent = "PAUSED";
            this.statusLabel.style.background = "rgba(255, 211, 42, 0.2)";
            this.statusLabel.style.color = "#ffd32a";
            this.statusLabel.style.borderColor = "rgba(255, 211, 42, 0.3)";
        } else {
            this.pauseIconToPause();
            this.recordingStatus.classList.add("pulse");
            this.statusLabel.textContent = "LIVE";
            this.statusLabel.style.background = "rgba(255, 94, 87, 0.2)";
            this.statusLabel.style.color = "#ff5e57";
            this.statusLabel.style.borderColor = "rgba(255, 94, 87, 0.3)";
        }

        this.micBtn.classList.toggle("active", this.isMicEnabled);
        this.sysAudioBtn.classList.toggle("active", this.isSysAudioEnabled);
        this.webcamBtn.classList.toggle("active", this.isWebcamEnabled);
        this.drawBtn.classList.toggle("active", state.isDrawingActive);
        this.presenterBtn.classList.toggle("active", state.isPresenterMode);
    }

    togglePause() {
        window.electronAPI.sendMiniCommand({ action: "toggle-pause" });
    }

    stopRecording() {
        window.electronAPI.sendMiniCommand({ action: "stop-recording" });
    }

    discardRecording() {
        if (confirm("Are you sure you want to discard this recording? It will be permanently deleted.")) {
            window.electronAPI.sendMiniCommand({ action: "discard-recording" });
        }
    }

    toggleMic() {
        window.electronAPI.sendMiniCommand({ action: "toggle-mic" });
    }

    toggleSysAudio() {
        window.electronAPI.sendMiniCommand({ action: "toggle-sys-audio" });
    }

    toggleWebcam() {
        window.electronAPI.sendMiniCommand({ action: "toggle-webcam" });
    }

    toggleDraw() {
        window.electronAPI.sendMiniCommand({ action: "toggle-draw" });
    }

    togglePresenter() {
        window.electronAPI.sendMiniCommand({ action: "toggle-presenter" });
    }

    hideMiniWindow() {
        window.electronAPI.sendMiniCommand({ action: "hide-mini" });
    }

    toggleCollapse() {
        this.isCollapsed = !this.isCollapsed;
        this.toolbar.classList.toggle("collapsed", this.isCollapsed);
        this.collapseBtn.title = this.isCollapsed ? "Expand Mode (F)" : "Focus Mode (F)";
    }

    enableDrag() {
        const dragHandle = document.querySelector(".drag-handle");
        if (!dragHandle) return;

        let isDragging = false;
        let startX, startY, winX, winY;
        let animationFrameId = null;

        dragHandle.addEventListener("mousedown", (e) => {
            isDragging = true;
            startX = e.screenX;
            startY = e.screenY;
            if (window.electronAPI?.getMiniWindowPosition) {
                const pos = window.electronAPI.getMiniWindowPosition();
                winX = pos.x;
                winY = pos.y;
            }
            dragHandle.style.cursor = "grabbing";
            e.preventDefault();
            e.stopPropagation();
        });

        window.addEventListener("mousemove", (e) => {
            if (!isDragging) return;
            const deltaX = e.screenX - startX;
            const deltaY = e.screenY - startY;

            if (animationFrameId) {
                cancelAnimationFrame(animationFrameId);
            }

            animationFrameId = requestAnimationFrame(() => {
                if (window.electronAPI?.moveMiniWindow) {
                    window.electronAPI.moveMiniWindow(winX + deltaX, winY + deltaY);
                }
            });
        });

        window.addEventListener("mouseup", () => {
            if (isDragging) {
                isDragging = false;
                dragHandle.style.cursor = "grab";
                if (animationFrameId) {
                    cancelAnimationFrame(animationFrameId);
                    animationFrameId = null;
                }
            }
        });
    }

    pauseIconToPlay() {
        this.pauseBtn.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="none">
        <polygon points="5,3 19,12 5,21" />
      </svg>`;
        this.pauseBtn.title = "Resume (P)";
    }

    pauseIconToPause() {
        this.pauseBtn.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="6" y="4" width="4" height="16" />
        <rect x="14" y="4" width="4" height="16" />
      </svg>`;
        this.pauseBtn.title = "Pause (P)";
    }
}

// Instantiate when DOM is ready
document.addEventListener("DOMContentLoaded", () => {
    new MiniControls();
});
