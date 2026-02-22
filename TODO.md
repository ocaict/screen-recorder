# Screen Recorder App - Rebuild Tasks

## Phase 1: Project Setup

- [x] Create project structure and organize files
- [x] Set up main process with proper window management
- [x] Create preload script with complete IPC bridge
- [x] Build UI with HTML/CSS for the recorder interface

## Phase 2: Core Features

- [x] Implement screen capture functionality
- [x] Implement audio capture with device selection
- [x] Implement MediaRecorder with proper chunk handling
- [x] Add ffmpeg conversion with progress tracking

## Phase 3: System Integration

- [x] Implement system tray integration
- [x] Add global shortcut for stop recording
- [x] Add settings persistence

## Phase 4: Quality & Testing

- [x] Fix all bugs and edge cases
- [x] Test and verify functionality

---

## Project Structure

```
ScreenCapturer/
├── src/
│   ├── main/
│   │   ├── main.js          # Main process entry
│   │   ├── tray.js          # System tray management
│   │   ├── shortcuts.js     # Global shortcuts
│   │   ├── ipc-handlers.js # IPC communication
│   │   └── state.js        # Recording state
│   ├── preload/
│   │   └── preload.js      # Preload script (IPC bridge)
│   ├── renderer/
│   │   ├── index.html      # Main UI
│   │   ├── styles.css      # Styles
│   │   ├── renderer.js     # Main controller
│   │   ├── recording.js    # Recording logic
│   │   ├── sources.js      # Source selection
│   │   └── ui.js           # UI helpers
│   └── utils/
│       ├── logger.js       # Logging utility
│       ├── settings.js     # Settings persistence
│       └── ffmpeg.js      # FFmpeg handler
├── package.json
├── TODO.md
└── ...
```

## Features Implemented

- Screen/window capture with source selection modal
- Audio recording with device selection
- Recording timer and indicator
- System tray integration (normal + recording mode)
- Global shortcut (F9) to stop recording
- Settings persistence (quality, resolution, frame rate, output directory)
- Video conversion from WebM to MP4 with progress tracking
- Dark theme UI with custom titlebar
- Open file location / play video after recording
- Disk space validation
- Window close during recording confirmation
- Settings validation
- Pause/Resume recording functionality
- Recording countdown timer (3, 2, 1)
- Auto-save recordings to specified folder
- Custom filename patterns (date, time)
- Video compression/optimization
- Recent recordings list with metadata
- Minimize to system tray while recording
- Recording hotkey overlay (show when recording)
- Hardware acceleration for encoding (NVENC, QSV, AMF)
- Background processing during conversion
- Memory protection for long recordings
- Windows notification on recording complete
- Conversion progress feedback (toast + overlay)
- Preview reset after recording (shows "Recording Complete" message)
- Content Security Policy

---

## Future Enhancements & Features

### Recording Features

- [x] Pause/Resume recording functionality
- [x] Recording countdown timer (3, 2, 1)
- [x] Add webcam overlay/picture-in-picture
- [x] Record specific area (region selection) instead of full screen/window
- [x] Schedule recording (record at specific time)
- [ ] Record system audio (without microphone)
- [ ] Add annotation/drawing on screen during recording
- [x] Custom hotkeys for stop recording

### Video Editing

- [ ] Trim video (start/end points)
- [ ] Merge multiple recordings
- [ ] Add intro/outro to videos
- [ ] Basic video effects (crop, rotate, zoom)

### Output & Storage

- [x] Auto-save recordings to specified folder (without save dialog)
- [x] Custom filename patterns (date, time, custom prefix)
- [x] Video compression/optimization
- [x] Output format selection (MP4, WebM)
- [ ] Upload to cloud (YouTube, Google Drive, etc.)

### UI/UX Improvements

- [x] Recent recordings list
- [x] Minimize to system tray while recording
- [x] Recording hotkey overlay (show when recording)
- [ ] Multiple language support (i18n)
- [ ] Keyboard shortcuts for all actions
- [ ] Drag and drop to reorder recordings
- [ ] Thumbnail preview for saved recordings
- [x] Recording history with metadata

### Performance & Optimization

- [x] Hardware acceleration for encoding (NVENC, QSV, VCE)
- [x] Background processing (don't block UI during conversion)
- [x] Memory usage optimization for long recordings
- [ ] Multi-threaded encoding
- [ ] Streaming upload while recording

### System Integration

- [x] Windows notification on recording start/stop
- [ ] Start with Windows (auto-start)
- [ ] Global exception handling with crash reports
- [ ] Portable mode (run from USB)
- [ ] Portable settings file

### Observability & Support

- [x] Add a diagnostics page showing ffmpeg path, hardware encoders
- [ ] Add a "collect logs" troubleshooting command
- [ ] Optional anonymized telemetry (opt-in)

### Quality & Testing

- [ ] Add unit tests
- [ ] Add integration tests
- [ ] Automated UI tests
- [ ] Performance benchmarking
- [ ] Memory leak detection
- [x] Error logging to file
- [ ] CI smoke tests

### Distribution

- [ ] Auto-updater
- [ ] Build for macOS
- [ ] Build for Linux
- [ ] Code signing
- [ ] Installer (NSIS, Inno Setup)
- [ ] Portable executable

### Packaging

- [ ] Bundle a tested per-platform ffmpeg with checksums

### Advanced Features

- [ ] Live streaming (RTMP output)
- [ ] Green screen/chroma key support
- [ ] Audio visualization (waveform)
- [ ] Video thumbnails generation
- [ ] GIF export
- [ ] Batch conversion
- [ ] Recording templates (preset settings)

---

## Code Quality Improvements Implemented

- [x] Split main.js into modules (tray, shortcuts, ipc-handlers, state)
- [x] Split renderer.js into modules (recording, sources, ui)
- [x] Added Content Security Policy
- [x] Memory monitoring during recording
- [x] Auto-stop recording on memory threshold
- [x] Improved conversion feedback to user
