# Recommendations & Enhancements Checklist

## 🚀 New Features (High Priority)
- [ ] **Video Editor**: Add basic editing capabilities like merging clips, adding intro/outro, and inserting transitions.
- [ ] **Auto-crop**: Implement AI-powered automatic removal of black bars from recordings.
- [ ] **GIF Preview**: Allow previewing GIFs before saving, with size and length options.
- [] **Hotspots/Click Highlights**: Add visual highlights on mouse clicks during recording.
- [] **Cursor Customization**: Provide options to show/hide the cursor and apply custom cursor effects.
- [ ] **Scheduled Recurring Recording**: Support daily/weekly automated recordings.
- [ ] **Cloud Upload**: Integrate direct upload functionality to YouTube, Google Drive, etc.

## 🎨 UI Optimizations (Medium Priority)
- [ ] **Collapsible Sidebar**: Add a toggle to expand/collapse the right sidebar to maximize the preview area.
- [ ] **Dark/Light Mode Toggle**: Offer a light theme option alongside the polished dark theme.
- [ ] **Floating Mini-Controls**: Show minimal floating controls instead of the full UI during recording.
- [ ] **Drag-and-Drop Reorder**: Allow reordering clips in the recent recordings list via drag-and-drop.
- [ ] **Improved Source Selection Modal**: Add search/filter functionality for sources and allow multi-select.
- [ ] **Better Mobile Responsiveness**: Improve scaling on different window sizes for the desktop app.
- [ ] **Real-time Recording Preview Thumbnails**: Show a thumbnail strip of recorded segments.
- [ ] **Annotation Toolbar Float**: Make the annotation toolbar draggable and positionable.

## ✨ Enhancements (Low Priority)
- [ ] **Recording templates**: Add pre-configured settings for gaming, tutorials, meetings, etc.
- [ ] **Keyboard shortcut customization**: Let users rebind all hotkeys.
- [ ] **Audio noise removal**: Add an AI-based noise cancellation filter.
- [ ] **Video filters**: Enable brightness/contrast adjustments post-recording.
- [] **Custom watermarks**: Add text/image watermark capabilities to recordings.
- [ ] **Batch export**: Allow exporting multiple recordings at once.
- [ ] **Recording markers**: Add markers during recording for easy editing later.
- [ ] **Theme customization**: Allow accent color changes.

## 🛠️ Technical Improvements
- [] **Error Recovery**: Implement better handling when sources are disconnected mid-recording (added WebM backup fallback).
- [ ] **Recording Pause Auto-save**: Save progress periodically to prevent data loss in case of crashes.
- [ ] **Multi-monitor Support**: Improve handling of multi-monitor setups.
- [ ] **Recording History Storage**: Migrate metadata storage from localStorage to IndexedDB.
- [] **Memory Optimization**: Stream processing to disk instead of using RAM for long recordings.
- [ ] **Background Processing**: Allow converting videos while starting new recordings.
- [x] **Real-time FFmpeg MP4 Pipe**: Stream video chunks to FFmpeg for real-time MP4 encoding, bypassing the intermediate WebM file and saving conversion time.
    - ✅ Direct MP4 output (no post-conversion needed)
    - ✅ Audio-video sync (captured together)
    - ✅ Lower CPU usage
    - ✅ More reliable recording
- [x] **Advanced Encoder Settings**: Added granular control for video quality and performance.
    - ✅ H.264 & H.265 (HEVC) Support
    - ✅ CRF (Constant Quality) & VBR (Variable Bitrate) modes
    - ✅ Chroma Subsampling options (4:2:0 vs 4:4:4)
- [x] **Native Resolution Capture**: Ability to record at the display's original resolution without downscaling.