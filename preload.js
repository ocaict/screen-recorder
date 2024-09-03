const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  showFileMenu: (type) => ipcRenderer.invoke("open-file-menu", type),
  minimizeWindow: () => ipcRenderer.invoke("minimize-window"),
  restoreOrMaximizeWindow: () => ipcRenderer.invoke("restore-maximize-window"),
  getCaptureSources: () => ipcRenderer.invoke("get-capture-sources"),
  hideRecorder: () => ipcRenderer.invoke("hide-recorder"),
  closeApp: () => ipcRenderer.invoke("close-app"),
});

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
  let convertMessageContainer = document.querySelector(".convert-message");
  let settingOkBtn = document.querySelector(".setting-ok-btn");
  let settingContainer = document.querySelector(".setting-container");
  let settingBtn = document.querySelector(".setting-btn");
  let openRecordedLocationBtn = document.querySelector(".open-location-btn");
  let playWithDefaultPlayerBtn = document.querySelector(
    ".play-with-default-btn"
  );

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

  const showMessage = (msg) => {
    convertMessageContainer.innerHTML = `<h3>${msg}</h3>`;
    convertMessageContainer.classList.remove("hide");
    return convertMessageContainer;
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
            maxFrameRate: 60,
            minFrameRate: 30,
          },
        },
      });

      audio = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 44100,
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
      console.warn("No stream Avaible");
    }
  }

  async function startRecording() {
    // await setupStream();
    if (stream && audio) {
      mixedStream = new MediaStream([
        ...stream.getTracks(),
        ...audio.getTracks(),
      ]);
      recorder = new MediaRecorder(mixedStream);
      recorder.ondataavailable = handleDataAvailable;
      recorder.onstop = handleStop;
      recorder.start(200);

      showMessage("Recording Your Screen...");
    } else {
      showMessage("No Screen Selected!");
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
      showMessage("Processing Video...");
    };

    stream.getTracks().forEach((track) => track.stop());
    audio.getTracks().forEach((track) => track.stop());
    recordedChunks = [];
    stream = null;
    audio = null;
    recorder = null;
  }

  function stopRecording() {
    if (!recorder) return showMessage("No Recording Available");

    return recorder.stop();
  }

  stopBtn.addEventListener("click", () => {
    stopRecording();
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
  // Conversion to mp4 completed
  ipcRenderer.on("conversion-complete", (_, filePath) => {
    showMessage("Video Converted!");
    videoElement.src = filePath;
    recordedLocation = filePath;
    videoElement.addEventListener("loadedmetadata", () => videoElement.play());
  });

  // Stop Recorded when task bar icon clicked on stop
  ipcRenderer.on("stop-recorder", () => {
    ipcRenderer.invoke("show-recorder");
    stopBtn.click();
  });

  ipcRenderer.on("record-terminated", () => {
    showMessage("Terminated!");
  });

  // Open Recorded File location
  openRecordedLocationBtn.addEventListener("click", () => {
    if (!recordedLocation) return;
    ipcRenderer.invoke("open-recorded-location", recordedLocation);
  });

  playWithDefaultPlayerBtn.addEventListener("click", () => {
    if (!recordedLocation) return;
    ipcRenderer.invoke("play-with-default-player", recordedLocation);
  });

  // Get Default Screen Source
  ipcRenderer.invoke("get-default-source").then((source) => {
    setupStream(source);
  });

  ipcRenderer.on("error-message", (e, err) => {
    console.log(err);
  });

  ipcRenderer.on("conversion-progress", (e, progress) => {
    console.log(progress);
  });

  // End of DOM Listener
});
