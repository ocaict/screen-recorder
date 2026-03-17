# Screen Recorder App — Master TODO


## ✅ Phase 1 – Phase 4: Core Build (All Complete)

- [x] Create project structure and organize files
- [x] Set up main process with proper window management
- [x] Create preload script with complete IPC bridge
- [x] Build UI with HTML/CSS for the recorder interface
- [x] Implement screen capture functionality
- [x] Implement audio capture with device selection
- [x] Implement MediaRecorder with proper chunk handling
- [x] Add FFmpeg conversion with progress tracking
- [x] Implement system tray integration
- [x] Add global shortcut for stop recording
- [x] Add settings persistence
- [x] Fix all bugs and edge cases

---

## 🎬 Recording Features

- [x] Pause/Resume recording functionality
- [x] Recording countdown timer (3, 2, 1) with sound beep
- [x] Add webcam overlay / picture-in-picture
- [x] Record specific area (region selection) instead of full screen/window
- [x] Schedule recording (record at specific time)
- [x] Scheduled recurring recording (daily/weekly not yet — basic time scheduling done)
- [x] Record system audio (without microphone)
- [x] Add annotation / drawing on screen during recording
- [x] Custom hotkeys for stop/pause recording
- [x] Floating annotation toolbar (draggable, positionable, rAF-optimized)
- [x] Hotspots / click highlights (visual ripple on mouse clicks during recording)
- [x] Recording Pause Auto-save — periodic chunked saves to prevent crash data loss
- [x] Discard / Cancel Recording — trash ongoing recording and delete temp files
- [x] Audio meter shows on source select (before recording starts)
- [x] Real-time FFmpeg MP4 pipe — stream chunks directly to FFmpeg (no post-conversion WebM)
- [ ] Cursor customization (show/hide, custom cursor effects)
- [ ] Live streaming (RTMP output)
- [ ] Recording markers (add timestamps during recording for easy editing)
- [ ] Green screen / chroma key support

---

## ✂️ Video Editing

- [x] Trim video (start/end points)
- [x] Merge multiple recordings
- [ ] Add intro/outro to videos
- [ ] Basic video effects (crop, rotate, zoom)
- [x] GIF export
- [ ] GIF preview before saving (size/length options)
- [ ] Batch conversion / batch export
- [ ] Video filters (brightness/contrast post-recording)
- [x] Custom watermarks (text/image overlay)

---

## 💾 Output & Storage

- [x] Auto-save recordings to specified folder (no dialog)
- [x] Custom filename patterns (date, time, custom prefix)
- [x] Video compression / optimization
- [x] Output format selection (MP4, WebM)
- [x] Video thumbnails generation
- [x] Recording history with metadata (recent recordings list)
- [ ] Recording History Storage: Migrate metadata from `settings.json` (fs) to IndexedDB
- [ ] Upload to cloud (YouTube, Google Drive, etc.)
- [ ] Streaming upload while recording

---

## 🎨 UI / UX

- [x] Recent recordings list with metadata
- [x] Minimize to system tray while recording
- [x] Recording hotkey overlay (shown when recording active)
- [x] Thumbnail preview for saved recordings
- [x] Floating mini-controls during recording (draggable, pause/stop/discard/mic/webcam)
- [x] Annotation toolbar float (draggable, all tools with custom tooltips)
- [x] Settings button disabled during recording (prevents mid-session config changes)
- [x] Live mic level meter in Settings modal (horizontal bar, green/yellow/red)
- [x] Hardware info / diagnostics page (FFmpeg path, encoder availability)
- [x] Advanced encoder settings (H.264/H.265, CRF/VBR, chroma subsampling)
- [x] Native resolution capture (records at display's actual pixel density)
- [x] Fixed app window size (1050x700) and non-resizable
- [x] Collapsible sidebar (toggle to expand/collapse right panel)
- [ ] Dark / Light mode toggle
- [ ] Multiple language support (i18n)
- [ ] Improved source selection modal (search/filter, multi-select)
- [ ] Better window scaling / mobile responsiveness
- [ ] Real-time recording preview thumbnails (segment strip)
- [ ] Drag-and-drop reorder recordings in recent list
- [ ] Keyboard shortcut customization (rebind all hotkeys)
- [ ] Theme customization (accent color changes)
- [ ] Auto-crop (AI-powered removal of black bars)

---

## ⚡ Performance & Optimization

- [x] Hardware acceleration for encoding (NVENC, QSV, AMF)
- [x] Background processing (UI not blocked during conversion)
- [x] Memory usage optimization for long recordings (auto-stop on threshold)
- [x] Multi-threaded encoding
- [x] Memory monitoring during recording
- [x] rAF-based drag for annotation palette and mini-controls (GPU-accelerated)
- [x] Error Recovery: WebM backup fallback when source disconnects mid-recording
- [x] Memory Optimization: stream processing to disk instead of RAM for very long recordings
- [ ] Background Processing: convert videos while a new recording starts
- [x] Audio noise removal (AI-based noise cancellation filter)

---

## 🛠️ Technical / System

- [x] Split `main.js` into modules (tray, shortcuts, ipc-handlers, state)
- [x] Split `renderer.js` into modules (recording, sources, ui, settings-handler, etc.)
- [x] Added Content Security Policy
- [x] Error logging to file
- [x] Windows notification on recording start/stop
- [x] Real-time FFmpeg MP4 pipe (chunked direct encoding)
- [x] Multi-monitor support (display-aware source selection and compositor sync) (partially implemented)
- [ ] Recording History Storage: migrate from `settings.json` to IndexedDB
- [ ] Start with Windows (auto-start on login)
- [ ] Global exception handling with crash reports
- [ ] Portable mode (run from USB, no install)
- [ ] Portable settings file
- [ ] Collect logs troubleshooting command
- [ ] Optional anonymized telemetry (opt-in)
- [ ] Bundle a tested per-platform FFmpeg binary with checksums

---

## 🧪 Quality & Testing

- [x] Error logging to file
- [ ] Add unit tests
- [ ] Add integration tests
- [ ] Automated UI tests
- [ ] Performance benchmarking
- [ ] Memory leak detection
- [ ] CI smoke tests

---

## 📦 Distribution

- [ ] Auto-updater
- [ ] Code signing *(Windows build uses signtool.exe)*
- [ ] Build for macOS
- [ ] Build for Linux
- [ ] Installer (NSIS / Inno Setup)
- [ ] Portable executable

---

## 🏗️ Project Structure

```
ScreenCapturer/
├── src/
│   ├── main/
│   │   ├── main.js               # Main process entry + window management
│   │   ├── tray.js               # System tray management
│   │   ├── shortcuts.js          # Global shortcuts
│   │   ├── ipc-handlers.js       # IPC communication + FFmpeg chunked recording
│   │   └── state.js              # Recording state
│   ├── preload/
│   │   ├── preload.js            # Main preload (IPC bridge)
│   │   └── mini-preload.js       # Mini-controls preload
│   ├── renderer/
│   │   ├── index.html            # Main UI
│   │   ├── styles.css            # Main styles
│   │   ├── renderer.js           # Main controller + mic meter
│   │   ├── recording.js          # Recording logic + discard + preview meter
│   │   ├── sources.js            # Source selection
│   │   ├── ui.js                 # UI helpers + modal management
│   │   ├── settings-handler.js   # Settings open/save/reset + mic meter wiring
│   │   ├── timer-controls.js     # Countdown + timer
│   │   ├── annotation-palette.html/css/js  # Floating annotation toolbar
│   │   └── mini-controls.html/css/js       # Floating mini recording controls
│   └── utils/
│       ├── logger.js             # Logging utility
│       ├── settings.js           # Settings persistence (JSON/fs)
│       └── ffmpeg.js             # FFmpeg handler
├── package.json
├── TODO.md                       # ← This file (master task list)
└── ...
```
