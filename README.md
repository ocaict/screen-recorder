# OcaTech MakeVideo (Screen Capturer)

A powerful, high-performance screen recording application built with Electron. Designed for creating professional video tutorials, presentations, and guides with real-time annotations.

## 🌟 Key Features

### 🎥 Advanced Recording Capabilities
* **Flexible Sources:** Record your entire screen, a specific application window, or a custom-drawn region.
* **True Native Resolution:** Accurately captures multi-display setups at their true physical resolution without downscaling, including 4K support.
* **Audio Capture:** Simultaneously record System Audio and Microphone inputs.
* **Floating Webcam:** Picture-in-Picture (PiP) webcam overlay with dynamic transitions (expanding, shrinking, and camera-only focus modes) to make tutorials more engaging.

### ⚡ Professional Performance
* **Live MP4 Muxing:** Converts video chunks on-the-fly directly to MP4 during the recording. No long waiting times when you hit "Stop".
* **Hardware Acceleration:** Native FFmpeg integration with intelligent fallback. Automatically detects and utilizes GPU hardware encoders (NVIDIA NVENC, Intel QSV, AMD AMF) for zero-lag CPU recording.
* **Memory Safe:** Engineered to stream data directly to the disk, keeping RAM usage low even during hours-long recording sessions.

### 🖍️ Real-Time On-Screen Annotations
Draw directly on your screen while recording using the live overlay palette:
* **Numbered Steps:** Automatically incrementing sticker steps to map out click-paths.
* **Shapes & Freehand:** Draw arrows, boxes, and freehand lines to highlight important information.
* **Click Highlights:** Visual mouse-click ripples to ensure viewers never miss your actions.

### ✂️ Post-Processing Tools
* **In-App Trimmer:** Quickly trim the start and end of your captured videos before sharing.
* **GIF Export:** Convert selected portions of your video recordings into lightweight GIFs.
* **Video Merging:** Stitch multiple recordings together natively.

## 🚀 Tech Stack

- **Framework:** Electron (v40+)
- **Frontend UI:** Vanilla JS, HTML5, CSS3 
- **Media Engine:** MediaStream API / DesktopCapturer
- **Video Encoding:** `fluent-ffmpeg` & `ffmpeg-static`
- **Global Event Hooks:** `uiohook-napi` (for capturing global hotkeys and mouse actions outside the window)

## 🛠️ Installation & Setup

### Prerequisites
Make sure you have [Node.js](https://nodejs.org/) installed on your machine.

### Local Development

1. **Clone the repository:**
   ```bash
   git clone https://github.com/ocaict/screen-recorder.git
   cd screen-recorder
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Start the application in development mode:**
   ```bash
   npm run dev
   ```

### Packaging for Production

To build a standalone `.exe` installer for Windows:

```bash
npm run build
```
The generated installer will be located in the `dist/` directory.

## ⌨️ Global Shortcuts

- **F9:** Start / Pause / Resume Recording
- **F2:** Toggle Annotation Tools (Drawing, Shapes, Steps)

## 📂 Project Structure Overview

- **`src/main/`**: Electron backend, IPC event handlers, FFmpeg spawning, and window management.
- **`src/renderer/`**: Frontend UI logic (`renderer.js`, `recording.js`, `annotation-manager.js`, `timer-controls.js`).
- **`src/preload/`**: Bridge between the secure main process and the renderer (context bridge).

## 📄 License
This project is licensed under the MIT License - see the LICENSE file for details.

## 👨‍💻 Author
**Oluegwu Chigozie**
