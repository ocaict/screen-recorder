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
│   │   └── main.js          # Main process
│   ├── preload/
│   │   └── preload.js      # Preload script (IPC bridge)
│   ├── renderer/
│   │   ├── index.html      # Main UI
│   │   ├── styles.css      # Styles
│   │   └── renderer.js     # Frontend logic
│   └── utils/
│       ├── logger.js       # Logging utility
│       ├── settings.js     # Settings persistence
│       └── ffmpeg.js       # FFmpeg handler
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

---

## Future Enhancements & Features

### Recording Features

- [x] Pause/Resume recording functionality
- [x] Recording countdown timer (3, 2, 1)
- [ ] Add webcam overlay/picture-in-picture
- [ ] Record specific area (region selection) instead of full screen/window
- [ ] Schedule recording (record at specific time)
- [ ] Record system audio (without microphone)
- [ ] Add annotation/drawing on screen during recording
- [ ] Custom hotkeys for start/stop/pause

### Video Editing

- [ ] Trim video (start/end points)
- [ ] Merge multiple recordings
- [ ] Add intro/outro to videos
- [ ] Basic video effects (crop, rotate, zoom)

### Output & Storage

- [x] Auto-save recordings to specified folder (without save dialog)
- [x] Custom filename patterns (date, time, custom prefix)
- [x] Video compression/optimization
- [ ] Output format selection (MP4, WebM, MKV, AVI)
- [ ] Upload to cloud (YouTube, Google Drive, etc.)

### UI/UX Improvements

- [x] Recent recordings list
- [x] Minimize to system tray while recording
- [x] Recording hotkey overlay (show when recording)
- [ ] Multiple language support (i18n)
- [ ] Keyboard shortcuts for all actions
- [ ] Drag and drop to reorder recordings
- [ ] Thumbnail preview for saved recordings
- [ ] Recording history with metadata

### Performance & Optimization

- [x] Hardware acceleration for encoding (NVENC, QSV, VCE) - UI implemented, requires system FFmpeg
- [x] Background processing (don't block UI during conversion)
- [ ] Chunked recording (save chunks periodically to prevent data loss)
- [ ] Memory usage optimization for long recordings
- [ ] Multi-threaded encoding
- [ ] Streaming upload while recording

### System Integration

- [x] Windows notification on recording start/stop
- [ ] Start with Windows (auto-start)
- [ ] Global exception handling with crash reports
- [ ] Portable mode (run from USB)
- [ ] Portable settings file

### Observability & Support

- [ ] Add a diagnostics page showing `ffmpeg` path, build flags, GPU/driver versions, and run-time encoder test
- [ ] Add a "collect logs" troubleshooting command and UI action to bundle logs for support
- [ ] Optional anonymized telemetry (opt-in): report hardware-fallback rates and major conversion errors

### Quality & Testing

- [ ] Add unit tests
- [ ] Add integration tests
- [ ] Automated UI tests
- [ ] Performance benchmarking
- [ ] Memory leak detection
- [ ] Error logging to file
- [ ] CI smoke tests: headless recording → conversion pipeline to validate bundled `ffmpeg` and fallback behavior

### Distribution

- [ ] Auto-updater
- [ ] Build for macOS
- [ ] Build for Linux
- [ ] Code signing
- [ ] Installer (NSIS, Inno Setup)
- [ ] Portable executable

### Packaging

- [ ] Bundle a tested per-platform `ffmpeg` (Windows/macOS/Linux) with checksums and add packaging scripts to verify and extract during build

### Advanced Features

- [ ] Live streaming (RTMP output)
- [ ] Green screen/chroma key support
- [ ] Audio visualization (waveform)
- [ ] Video thumbnails generation
- [ ] GIF export
- [ ] Batch conversion
- [ ] Recording templates (preset settings)
