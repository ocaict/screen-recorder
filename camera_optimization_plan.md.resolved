# Webcam Performance Optimization & Feature Plan

## 1. Performance Optimization
The webcam feature in a screen recorder can introduce significant overhead if not handled carefully, as you are decoding and compositing two separate high-quality video sources 30 to 60 times a second. Here are the core optimization areas:

### A. Constrain Webcam Resolution at the Source
Currently, [recording.js](file:///c:/Users/oluegwuc/Desktop/projects/Electron%20js/ScreenCapturer/src/renderer/recording.js) calls `getUserMedia` with `{ video: {} }`. This means if a user has a 4K or 1080p webcam, the browser decodes a massive frame, pushes it to an `ImageBitmap`, and transfers it to the compositor worker, only for the worker to downscale it to `180px` (`webcamDisplayWidth`)! 
**Fix:** Apply ideal constraints when requesting the stream. Since the webcam appears very small in the layout, requesting a `640x480` or `1280x720` stream max will save a tremendous amount of CPU, GPU, and RAM.
```javascript
const constraints = {
  audio: false,
  video: {
    deviceId: cameraId !== "default" ? { exact: cameraId } : undefined,
    width: { ideal: 640 },
    height: { ideal: 480 },
    frameRate: { ideal: config.frameRate }
  }
};
```

### B. Migrate to `requestVideoFrameCallback`
Currently, the recording manager uses `requestAnimationFrame(drawFrame)` to pull frames from the `<video>` elements and send them to the [compositor-worker.js](file:///c:/Users/oluegwuc/Desktop/projects/Electron%20js/ScreenCapturer/src/renderer/compositor-worker.js). `requestAnimationFrame` runs at the monitor's refresh rate (often 60Hz, 120Hz, or 144Hz). If the webcam or screen is only outputting 30fps, you are duplicating processing, transferring identical `ImageBitmaps` to the worker, and drawing identical frames, which burns CPU.
**Fix:** Use `HTMLVideoElement.requestVideoFrameCallback()`. This API only fires when the browser literally has a new video frame decoded, ensuring you only composite exactly when necessary.

### C. Resource Cleanup
Ensure `webcamVideo` goes through a strict garbage collection phase. In [stopCurrentStream](file:///c:/Users/oluegwuc/Desktop/projects/Electron%20js/ScreenCapturer/src/renderer/recording.js#350-461), making sure all `srcObject` references are set to `null` and the video element is explicitly paused and removed.

---

## 2. Enhancements & Improvements

### A. Circular / Rounded Webcam Mask
Currently, the compositor worker uses a `roundRect` to draw the webcam frame. Modern applications (like Loom or ScreenStudio) use a perfect circle for the webcam. 
**Implementation:** In [compositor-worker.js](file:///c:/Users/oluegwuc/Desktop/projects/Electron%20js/ScreenCapturer/src/renderer/compositor-worker.js), use `ctx.clip()` with `ctx.arc()` to create a stunning circular mask for the webcam, and add a drop shadow or a thick customizable border stroke around it.

### B. Draggable Webcam
Instead of standard string positions (`bottom-right`, `top-left`), allow the user to drag the webcam around the screen freely. 
**Implementation:** Keep an X/Y coordinate setting for the webcam. Intercept drag events on the UI overlay and update the `settings.webcamX` and `settings.webcamY`, passing the new coordinates live to [compositor-worker.js](file:///c:/Users/oluegwuc/Desktop/projects/Electron%20js/ScreenCapturer/src/renderer/compositor-worker.js).

### C. Picture-in-Picture (PiP)
Currently, the webcam is baked into the video, which means the user can't always see themselves unless they are looking directly at your app's preview window. 
**Implementation:** You can programmatically call `webcamVideo.requestPictureInPicture()`. This leverages the Operating System's native PiP window, allowing a floating camera preview that sits above all other windows on the user's computer while they record.

---

## 3. New Features

### A. Virtual Background & Background Blur
This is highly requested for modern recorders.
**Implementation:** Integrate a lightweight ML model like Google's `MediaPipe Selfie Segmentation` or `TensorFlow.js BodyPix`. This would run in a separate Web Worker, parsing the webcam feed, mapping the person, and replacing the background with transparency or a blur before sending the `ImageBitmap` to the final compositor.

### B. Real-time Filters
Add basic visual aesthetics settings (e.g. Grayscale, Sepia, Brightness overlay, Contrast).
**Implementation:** Easily achievable by applying the `ctx.filter` property in [compositor-worker.js](file:///c:/Users/oluegwuc/Desktop/projects/Electron%20js/ScreenCapturer/src/renderer/compositor-worker.js) right before executing `ctx.drawImage` for the webcam.

### C. "Camera Only" Mode
Allow users to toggle a mode where the screen dims out or transitions away, making the webcam full-screen for an intro, and then shrinking it back down to the corner for the demo.
**Implementation:** Add basic tweening/animation logic to the `webcamDisplayWidth` and `webcamX`/`Y` properties in the compositor worker that responds to an IPC trigger.
