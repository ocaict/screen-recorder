# Region Capture — Current Implementation Analysis & Recommendations

---

## 🗺️ How It Currently Works (Architecture Flow)

```
User clicks "Select Region"
    ↓
renderer.js → window.electronAPI.startRegionSelection()
    ↓  (IPC invoke: "start-region-selection")
ipc-handlers.js → Opens region-select.html as a new BrowserWindow
    ↓
User drags to draw a rect → clicks Confirm
    ↓
region-select.html → ipcRenderer.send('region-selected-result', finalRegion)
    ↓
ipc-handlers.js resolves the promise → returns {x, y, width, height} to renderer
    ↓
renderer.js stores region in recordingManager.selectedRegion
    + opens a full-screen capture stream to show preview (second separate getUserMedia call!)
    ↓
On "Start Recording"
    ↓
recording.js → setupRegionStream()
    → Captures FULL screen again (third getUserMedia!)
    → Draws full frame into a cropCanvas at target size via setInterval
    → cropCanvas.captureStream(fps) = the actual recorded video stream
```

---

## 🐛 Bugs & Critical Issues Found

### 1. **`btnConfirm` Double-Registered (region-select.html:276 & 294)**
The `Confirm` button has **two identical `addEventListener('click', ...)`** handlers. Clicking confirm fires the IPC message TWICE — sending two `region-selected-result` messages. This is a copy-paste artifact and is a race condition bug.

```js
// Line 276 — first handler
btnConfirm.addEventListener('click', () => { ... ipcRenderer.send('region-selected-result', finalRegion); });

// Line 294 — EXACT DUPLICATE!
btnConfirm.addEventListener('click', () => { ... ipcRenderer.send('region-selected-result', finalRegion); });
```
**Fix:** Remove one of the duplicate handlers immediately.

---

### 2. **Three Separate Screen Capture Streams Opened**
The app creates **3 separate full-screen getUserMedia streams** for a single region recording:
- **Stream 1:** In [renderer.js](file:///c:/Users/oluegwuc/Desktop/projects/Electron%20js/ScreenCapturer/src/renderer/renderer.js) (line 58): for preview after selection
- **Stream 2:** Discarded, not stored cleanly — `this.currentPreviewStream` is set but never explicitly stopped
- **Stream 3:** In `recording.js → setupRegionStream()`: for actual recording

Each stream is a 1080p/4K source consuming significant GPU/CPU memory. Only one stream is needed.

---

### 3. **`setInterval` for Frame Cropping — Wrong Approach**
```js
this.cropInterval = setInterval(cropFrame, 1000 / frameRate);
```
`setInterval` is not frame-accurate — it drifts, can stack up on a slow system, and **does not sync with the display's vsync**. At 30fps that's `setInterval(fn, 33)` which can drop frames or double-capture.

**Should be:** `requestAnimationFrame()` loop for buttery-smooth capture locked to the GPU vsync.

---

### 4. **Region-Select uses `require('electron')` directly (CSP violation risk)**
```js
const { ipcRenderer } = require('electron');
```
Region-select.html is not using a preload — it's calling `require()` directly. This bypasses `contextIsolation` and is a **security anti-pattern**. It only works because `nodeIntegration` must be `true` for that window.

---

### 5. **DPI/Scale Factor Not Handled**
The scale factor calculation in [region-select.html](file:///c:/Users/oluegwuc/Desktop/projects/Electron%20js/ScreenCapturer/src/renderer/region-select.html):
```js
const scaleX = window.innerWidth / document.body.offsetWidth;
const scaleY = window.innerHeight / document.body.offsetHeight;
```
On a 4K display with 150% or 200% Windows DPI scaling, `scaleX` is likely `1.0` (same values) so the region coordinates are **wrong** on HiDPI screens. The correct approach is to use Electron's `screen.getPrimaryDisplay().scaleFactor`.

---

### 6. **No Minimum Region Size Enforcement During Recording**
The region-select UI requires `width > 10 && height > 10` to show the confirm button. But **nothing prevents a user from pre-selecting a valid region, then manually typing coordinates** or resizing their window between selection and recording start.

---

## ⚡ Performance Issues

| Problem | Impact | Priority |
|---------|--------|----------|
| 3 separate full-screen streams | High GPU/RAM usage, may cause OOM on low-end PCs | 🔴 High |
| `setInterval` frame loop instead of `requestAnimationFrame` | Frame drops, drift, tearing | 🔴 High |
| cropCanvas redraws entire canvas every frame without dirty checks | Wasted GPU fill rate | 🟡 Medium |
| Preview stream never stopped when region is re-selected | Stream leak | 🟡 Medium |
| No hardware-accelerated crop (uses 2D canvas software copy) | CPU overhead at 4K | 🟡 Medium |

---

## 🎨 UX Problems

| Problem | What Users Experience |
|---------|----------------------|
| No live preview inside the selection box | User can't see what's being captured while dragging |
| No aspect-ratio lock (Shift key) | Hard to make exact 16:9 selections |
| No keyboard nudge (arrow keys) to fine-tune position | Pixel-perfect placement is frustrating |
| No way to move/drag the selected box after drawing | Must redraw from scratch |
| Dimension label is above the box — clips off-screen at top | Confusing on top-edge selections |
| No "smart snap" to window edges or common resolutions | Hard to precisely capture a specific app window |
| Selection box dims the WHOLE screen equally | Hard to see what's inside vs outside selection |
| No saved region (remembers last selection) | Must redraw on every recording session |
| No crosshair/magnifier for pixel accuracy | Impossible to select exact pixel boundary |

---

## ✅ Recommended Improvements (Prioritized)

### 🔴 Critical Fixes (Do First)

1. **Remove duplicate `btnConfirm` event listener** in [region-select.html](file:///c:/Users/oluegwuc/Desktop/projects/Electron%20js/ScreenCapturer/src/renderer/region-select.html) (2 min fix)
2. **Replace `setInterval` with `requestAnimationFrame`** in [setupRegionStream()](file:///c:/Users/oluegwuc/Desktop/projects/Electron%20js/ScreenCapturer/src/renderer/recording.js#157-315) to fix frame timing
3. **Reuse a single screen stream** — capture once, pass the stream reference from preview to recording. Don't open 3 streams.
4. **Fix DPI scaling** — query `Electron.screen.getPrimaryDisplay().scaleFactor` from main process and pass it into the region-select window.

### 🟡 Important Improvements

5. **Add live screen thumbnail inside the selection box** — screenshot the desktop before opening the selector and show it as the background, so users can see exactly what's being captured.
6. **Add drag-to-reposition** — after drawing the box, allow moving it by click-dragging the center area.
7. **Save & restore last region** — persist `selectedRegion` to settings so it's pre-filled on next session.
8. **Add Shift+drag = 16:9 lock** — hold Shift while drawing to constrain to 16:9 or the last used aspect ratio.
9. **Add arrow key nudging** — after confirming, use arrow keys to shift the box by 1px or 10px (with Shift).

### 🟢 New Features to Add

10. **Window picker mode** — click on any open application window to auto-size the region to exactly that window's bounds (using `desktopCapturer` metadata with `thumbnails`).
11. **Preset resolutions** — quick buttons like `1280×720`, `1920×1080`, `1:1 Square`, `4:3` that snap the selection to standard sizes.
12. **Crosshair magnifier** — small 3x zoomed circle that follows the cursor during drag, making pixel-accurate selection possible.
13. **Region border indicator during recording** — show a thin colored border around the recorded region on screen while recording is active, so the user always knows what's being captured.
14. **Multi-display region** — allow spanning a region across monitors.

---

## 📐 Ideal Architecture (What It Should Look Like)

```
User clicks "Select Region"
    ↓
Main process takes a desktop screenshot (desktopCapturer, thumbnail)
    ↓
region-select window opens with the screenshot as its background
    + Shows blurred overlay with bright selection box (like Snipping Tool)
    ↓
User draws, moves, resizes using mouse + keyboard
    + Live "inside box" shows the clear screenshot
    ↓
User confirms → main process gets {x, y, width, height, scaleFactor}
    ↓
ONE getUserMedia stream opened at confirmed region size
    ↓
Preview + Recording both use same stream (captureStream() from canvas)
    ↓
On stop → stream tracks all stopped cleanly
```

---

## 📊 Summary Score

| Category | Current | Potential |
|----------|---------|-----------|
| Functionality | ✅ Works | ✅ |
| Performance | ⚠️ 3 streams, setInterval drift | 🚀 1 stream, rAF |
| UX/Polish | ⚠️ Basic, no live preview, no reposition | ✨ Snipping Tool quality |
| Stability/Bugs | 🐛 Duplicate IPC, DPI bug, stream leak | 🛡️ Solid |
| Security | ⚠️ bare require('electron') | 🔒 contextBridge preload |
