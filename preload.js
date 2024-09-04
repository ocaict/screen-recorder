const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  showFileMenu: (type) => ipcRenderer.invoke("open-file-menu", type),
  minimizeWindow: () => ipcRenderer.invoke("minimize-window"),
  restoreOrMaximizeWindow: () => ipcRenderer.invoke("restore-maximize-window"),
  getCaptureSources: () => ipcRenderer.invoke("get-capture-sources"),
  hideRecorder: () => ipcRenderer.invoke("hide-recorder"),
  closeApp: () => ipcRenderer.invoke("close-app"),
});
console.log("hi");
document.addEventListener("DOMContentLoaded", async () => {
  let stream = null;
  let audio = null;
  let mixedStream = null;
  let recorder = null;
  let recordedChunks = [];
  let selectedMicrophone = null;
  let defaultMicrophone = null;
  let recordedLocation = null;
  let videoElement = document.querySelector("video");
  let startBtn = document.querySelector(".start-btn");
  let stopBtn = document.querySelector(".stop-btn");
  let noticeMessageContainer = document.querySelector(".message-container");
  let settingOkBtn = document.querySelector(".setting-save-btn");
  let settingContainer = document.querySelector(".setting-container");
  let settingBtn = document.querySelector(".setting-btn");

  let selectScreenBtn = document.querySelector(".select-screen");
  let hideWindowBtn = document.querySelector(".hide-recorder-btn");
  let completedMessageContainer = document.querySelector(".completed-message");
  let loaderContainer = document.querySelector(".loader-container");
  const microphonesSelect = document.querySelector("#microphones-input");
  let options = "";
  const inputs = await navigator.mediaDevices.enumerateDevices();

  inputs.forEach((input) => {
    if (input.kind === "audioinput") {
      options += `<option value="${input.deviceId}" ${
        input.deviceId === "default" ? "selected" : ""
      } >${input.label}</option>`;

      if (input.deviceId === "default") {
        defaultMicrophone = input;
      }
    }
  });

  microphonesSelect.innerHTML = options;
  microphonesSelect.addEventListener("change", (e) => {
    selectedMicrophone = inputs.find((mic) => mic.deviceId === e.target.value);
  });

  const showMessage = (
    elem,
    button = false,
    msg = "Video Proccessed!",
    time = undefined
  ) => {
    elem.innerHTML = !button
      ? `<div class="notice-message">
          <h3 class="message">${msg}</h3>
        </div>`
      : ` <button class="btn hide-message-btn">
            <i class="hide-message-btn fas fa-xmark"></i>
          </button>
          <p>${msg}</p>
          <button class="btn open-location-btn">Open Video Location</button>
          <button class="btn play-with-default-btn">Play Video</button>
        `;

    elem.classList.remove("hide");

    if (time) {
      setTimeout(() => {
        elem.classList.add("hide");
      }, time);
    }
    return elem;
  };

  const hideMessage = (elem) => {
    elem.classList.add("hide");
  };

  async function setupStream(source) {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          mandatory: {
            chromeMediaSource: "desktop",
            chromeMediaSourceId: source.id,
            maxWidth: 1920,
            maxHeight: 1080,
            aspectRatio: 16 / 9,
            frameRate: { ideal: 60, min: 30 },
          },
          optional: [
            { minWidth: 1280 },
            { minHeight: 720 },
            { aspectRatio: 16 / 9 },
          ],
          cursor: "motion",
        },
      });

      audio = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 48000,
          channelCount: 2,
          autoGainControl: true,

          deviceId: selectedMicrophone
            ? selectedMicrophone.deviceId
            : defaultMicrophone.deviceId,
        },
      });

      setupVideoFeedBack();
    } catch (err) {
      console.log(err);
    }
  }

  function setupVideoFeedBack() {
    if (stream) {
      videoElement.srcObject = stream;
      videoElement.play();
    } else {
      showMessage(noticeMessageContainer, false, "No stream Avaible", 3000);
    }
  }

  async function startRecording() {
    // await setupStream();
    if (stream && audio) {
      mixedStream = new MediaStream([
        ...stream.getTracks(),
        ...audio.getTracks(),
      ]);
      stopBtn.classList.remove("hide-btn");
      hideWindowBtn.classList.remove("hide-btn");
      selectScreenBtn.classList.add("hide-btn");
      startBtn.classList.add("hide-btn");

      recorder = new MediaRecorder(mixedStream);
      recorder.ondataavailable = handleDataAvailable;
      recorder.onstop = handleStop;
      recorder.start(200);

      showMessage(
        noticeMessageContainer,
        false,
        "Recording Your Screen...",
        undefined
      );
    } else {
      showMessage(noticeMessageContainer, false, "No Screen Selected!", 3000);
    }
  }

  function handleDataAvailable(e) {
    recordedChunks.push(e.data);
  }

  function handleStop(e) {
    const blob = new Blob(recordedChunks, {
      type: "video/webm;codecs=vp9",
    });
    const reader = new FileReader();
    reader.readAsArrayBuffer(blob);
    reader.onload = async () => {
      const buffer = reader.result;
      ipcRenderer.invoke("handle-stream", buffer);
    };

    stream.getTracks().forEach((track) => track.stop());
    audio.getTracks().forEach((track) => track.stop());
    recordedChunks = [];
    stream = null;
    audio = null;
    recorder = null;
  }

  function stopRecording() {
    if (!recorder) return;
    return recorder.stop();
  }

  stopBtn.addEventListener("click", () => {
    stopRecording();
    stopBtn.classList.add("hide-btn");
    hideWindowBtn.classList.add("hide-btn");
    selectScreenBtn.classList.remove("hide-btn");
    startBtn.classList.remove("hide-btn");
    showMessage(noticeMessageContainer, false, "Preparing....", undefined);
  });

  startBtn.addEventListener("click", () => {
    // console.log(selectedMicrophone);
    // console.log(defaultMicrophone);

    startRecording();
    ipcRenderer.invoke("create-tray-menu");
  });

  settingOkBtn.addEventListener("click", (e) => {
    settingContainer.style.display = "none";
  });
  settingBtn.addEventListener("click", (e) => {
    settingContainer.style.display = "block";
  });

  // IPCRENDER
  ipcRenderer.on("source", async (_, source) => {
    await setupStream(source);
  });

  // Stop Recorded when task bar icon clicked on stop
  ipcRenderer.on("stop-recorder", () => {
    ipcRenderer.invoke("show-recorder");
    stopBtn.click();
  });

  ipcRenderer.on("record-terminated", () => {
    showMessage(noticeMessageContainer, false, "Terminated!", 2000);
    ipcRenderer.invoke("get-default-source").then((source) => {
      setupStream(source);
    });
  });

  completedMessageContainer.addEventListener("click", (e) => {
    if (e.target.className.includes("open-location-btn")) {
      if (!recordedLocation) return;
      ipcRenderer.invoke("open-recorded-location", recordedLocation);
    } else if (e.target.className.includes("play-with-default-btn")) {
      if (!recordedLocation) return;
      ipcRenderer.invoke("play-with-default-player", recordedLocation);
    } else if (e.target.className.includes("hide-message-btn")) {
      hideMessage(completedMessageContainer);
    }
  });

  // Get Default Screen Source
  ipcRenderer.invoke("get-default-source").then((source) => {
    setupStream(source);
  });

  ipcRenderer.on("error-message", (e, err) => {
    console.log(err);
  });
  let o = {
    frames: 3661,
    currentFps: 79,
    currentKbps: 691.1,
    targetSize: 10496,
    timemark: "00:02:04.41",
  };

  ipcRenderer.on("conversion-progress", (e, progress) => {
    showMessage(
      noticeMessageContainer,
      false,
      `Processing.... ${progress.timemark}`
    );
    loaderContainer.classList.remove("hide");
  });

  // Conversion to mp4 completed
  ipcRenderer.on("conversion-complete", (_, filePath) => {
    loaderContainer.classList.add("hide");
    showMessage(completedMessageContainer, true, "Video Proccessed!", false);
    hideMessage(noticeMessageContainer);
    recordedLocation = filePath;
    ipcRenderer.invoke("get-default-source").then((source) => {
      setupStream(source);
    });
  });

  // End of DOM Listener
});
