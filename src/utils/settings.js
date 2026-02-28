const fs = require("fs");
const path = require("path");
const { app } = require("electron");

let settings = {
  videoQuality: "high",
  frameRate: 24,
  resolution: "native",
  recordAudio: true,
  recordSystemAudio: false,
  selectedMicrophone: "default",
  outputDirectory: "",
  shortcutEnabled: true,
  shortcutKey: "F9",
  hideWindowDuringRecording: true,
  showNotifications: true,
  autoOpenAfterRecording: true,
  recordDirectToMp4: true,
  defaultFormat: "mp4",
  countdown: 3,
  recentRecordings: [],
  maxRecentRecordings: 10,
  filenamePattern: "Recording_{date}_{time}",
  autoSave: true,
  compression: "balanced",
  hardwareAcceleration: "none",
  webcamEnabled: false,
  selectedCamera: "default",
  webcamPosition: "bottom-right",
  webcamSize: "medium",
  videoCodec: "libx264",
  qualityControl: "crf",
  crfValue: 23,
  videoBitrate: 5,
  colorFormat: "yuv420p",
};

let settingsFile = null;

function getSettingsPath() {
  return app.isPackaged
    ? path.join(app.getPath("userData"), "settings.json")
    : path.join(__dirname, "..", "..", "settings.json");
}

async function loadSettings() {
  try {
    settingsFile = getSettingsPath();

    if (fs.existsSync(settingsFile)) {
      const data = fs.readFileSync(settingsFile, "utf8");
      const loaded = JSON.parse(data);
      settings = { ...settings, ...loaded };
    }

    if (!settings.outputDirectory) {
      settings.outputDirectory = app.getPath("videos");
    }

    if (
      settings.recentRecordings &&
      settings.recentRecordings.length > settings.maxRecentRecordings
    ) {
      settings.recentRecordings = settings.recentRecordings.slice(
        0,
        settings.maxRecentRecordings,
      );
      saveSettings(settings);
    }

    // hardwareAcceleration remains as configured or uses the default 'none'

    console.log("Settings loaded:", settings);
    return settings;
  } catch (err) {
    console.error("Failed to load settings:", err);
    return settings;
  }
}

function saveSettings(newSettings) {
  try {
    settings = { ...settings, ...newSettings };

    const dir = path.dirname(settingsFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
    console.log("Settings saved:", settings);
    return settings;
  } catch (err) {
    console.error("Failed to save settings:", err);
    return settings;
  }
}

function getSettings() {
  return { ...settings };
}

function resetSettings() {
  settings = {
    videoQuality: "high",
    frameRate: 24,
    resolution: "native",
    recordAudio: true,
    recordSystemAudio: false,
    selectedMicrophone: "default",
    outputDirectory: "",
    shortcutEnabled: true,
    shortcutKey: "F9",
    hideWindowDuringRecording: true,
    showNotifications: true,
    autoOpenAfterRecording: true,
    recordDirectToMp4: true,
    defaultFormat: "mp4",
    countdown: 3,
    recentRecordings: settings.recentRecordings || [],
    maxRecentRecordings: 10,
    filenamePattern: "Recording_{date}_{time}",
    autoSave: true,
    compression: "balanced",
    hardwareAcceleration: "none",
    videoCodec: "libx264",
    qualityControl: "crf",
    crfValue: 23,
    videoBitrate: 5,
    colorFormat: "yuv420p",
  };
  saveSettings(settings);
  return settings;
}

function addRecentRecording(filePath, thumbnailPath = null) {
  const fileName = path.basename(filePath);
  const stats = fs.existsSync(filePath) ? fs.statSync(filePath) : null;

  const recording = {
    filePath: filePath,
    thumbnailPath: thumbnailPath,
    fileName: fileName,
    recordedAt: new Date().toISOString(),
    size: stats ? stats.size : 0,
  };

  settings.recentRecordings = settings.recentRecordings.filter(
    (r) => r.filePath !== filePath,
  );
  settings.recentRecordings.unshift(recording);

  if (settings.recentRecordings.length > settings.maxRecentRecordings) {
    const removed = settings.recentRecordings.slice(settings.maxRecentRecordings);
    removed.forEach((r) => {
      if (r.thumbnailPath && fs.existsSync(r.thumbnailPath)) {
        try {
          fs.unlinkSync(r.thumbnailPath);
        } catch (e) { }
      }
    });

    settings.recentRecordings = settings.recentRecordings.slice(
      0,
      settings.maxRecentRecordings,
    );
  }

  saveSettings(settings);
  return settings;
}

function removeRecentRecording(filePath) {
  const recording = settings.recentRecordings.find((r) => r.filePath === filePath);
  if (recording && recording.thumbnailPath && fs.existsSync(recording.thumbnailPath)) {
    try {
      fs.unlinkSync(recording.thumbnailPath);
    } catch (e) { }
  }

  settings.recentRecordings = settings.recentRecordings.filter(
    (r) => r.filePath !== filePath,
  );
  saveSettings(settings);
  return settings;
}

function clearRecentRecordings() {
  settings.recentRecordings.forEach((r) => {
    if (r.thumbnailPath && fs.existsSync(r.thumbnailPath)) {
      try {
        fs.unlinkSync(r.thumbnailPath);
      } catch (e) { }
    }
  });

  settings.recentRecordings = [];
  saveSettings(settings);
  return settings;
}

function generateFilename(pattern, extension) {
  const now = new Date();
  const date = now.toISOString().split("T")[0];
  const time = now.toTimeString().split(" ")[0].replace(/:/g, "-");
  const timestamp = Date.now();

  let filename = pattern
    .replace(/{date}/g, date)
    .replace(/{time}/g, time)
    .replace(/{timestamp}/g, timestamp);

  return filename + "." + extension;
}

module.exports = {
  loadSettings,
  saveSettings,
  getSettings,
  resetSettings,
  addRecentRecording,
  removeRecentRecording,
  clearRecentRecordings,
  generateFilename,
};
