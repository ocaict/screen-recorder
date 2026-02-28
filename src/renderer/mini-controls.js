/**
 * Floating Mini Controls - Script
 * This runs in the dedicated lightweight Mini Window
 */

class MiniControls {
    constructor() {
        this.timerEl = document.getElementById("miniTimer");
        this.pauseBtn = document.getElementById("miniPauseBtn");
        this.stopBtn = document.getElementById("miniStopBtn");
        this.micBtn = document.getElementById("miniMicBtn");
        this.drawBtn = document.getElementById("miniDrawBtn");
        this.closeBtn = document.getElementById("miniCloseBtn");
        this.recordingStatus = document.getElementById("recordingStatus");

        this.isPaused = false;
        this.isMicEnabled = true;
        this.isDrawingActive = false;

        this.init();
    }

    init() {
        // Button Event Listeners
        this.pauseBtn.addEventListener("click", () => this.togglePause());
        this.stopBtn.addEventListener("click", () => this.stopRecording());
        this.micBtn.addEventListener("click", () => this.toggleMic());
        this.drawBtn.addEventListener("click", () => this.toggleDraw());
        this.closeBtn.addEventListener("click", () => this.closeMiniWindow());

        // Listen for state updates from the Main Process
        if (window.electronAPI) {
            window.electronAPI.onRecordingTimerUpdate((timeStr) => {
                this.timerEl.textContent = timeStr;
            });

            window.electronAPI.onRecordingStateUpdate((state) => {
                this.updateState(state);
            });
        }

        // Keyboard Shortcuts (Local to Mini Window)
        window.addEventListener("keydown", (e) => {
            switch (e.key.toLowerCase()) {
                case "p": this.togglePause(); break;
                case "s": this.stopRecording(); break;
                case "m": this.toggleMic(); break;
                case "d": this.toggleDraw(); break;
                case "escape": this.closeMiniWindow(); break;
            }
        });

        console.log("Mini Controls Initialized");
    }

    updateState(state) {
        // Sync UI with the actual recording state provided by Main process
        this.isPaused = state.isPaused;
        this.isMicEnabled = state.recordAudio;

        // Update Icons & Pulse
        if (this.isPaused) {
            this.pauseIconToPlay();
            this.recordingStatus.classList.remove("pulse");
        } else {
            this.pauseIconToPause();
            this.recordingStatus.classList.add("pulse");
        }

        this.micBtn.classList.toggle("active", this.isMicEnabled);
        this.drawBtn.classList.toggle("active", state.isDrawingActive);
    }

    togglePause() {
        window.electronAPI.sendMiniCommand({ action: "toggle-pause" });
    }

    stopRecording() {
        window.electronAPI.sendMiniCommand({ action: "stop-recording" });
    }

    toggleMic() {
        window.electronAPI.sendMiniCommand({ action: "toggle-mic" });
    }

    toggleDraw() {
        window.electronAPI.sendMiniCommand({ action: "toggle-draw" });
    }

    closeMiniWindow() {
        window.electronAPI.sendMiniCommand({ action: "close-mini" });
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
