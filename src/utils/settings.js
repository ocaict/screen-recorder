const fs = require("fs");
const path = require("path");
const { app } = require("electron");

const DEFAULT_SETTINGS = {
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
  showMiniControls: true,
  showClickHighlights: false,
  highlightLeftColor: "#FFEB3B",
  highlightRightColor: "#2196F3",
  highlightRippleSize: 50,
  highlightRippleSpeed: 400,
  highlightGlowSize: 25,
  highlightGlowIntensity: 30,
  idleDetectionEnabled: false,
  idleTimeoutMinutes: 5,
  memoryThresholdMB: 500,
  nvencPromptDismissed: false,
  countdownSound: true,
  timerPreset: 0,

  scheduledRecording: false,
  scheduleTime: "09:00"
};



let settings = { ...DEFAULT_SETTINGS };

let settingsFile = null;

function getSettingsPath() {
  if (settingsFile) return settingsFile;
  const userDataPath = app.getPath("userData");
  settingsFile = path.join(userDataPath, "settings.json");
  return settingsFile;
}

async function loadSettings() {
  const filePath = getSettingsPath();
  try {
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, "utf-8");
      const loadedSettings = JSON.parse(data);
      // Merge with defaults to handle new settings
      settings = { ...DEFAULT_SETTINGS, ...loadedSettings };
    }
  } catch (err) {
    console.error("Failed to load settings:", err);
    settings = { ...DEFAULT_SETTINGS };
  }

  // Ensure output directory exists or set to default
  if (!settings.outputDirectory) {
    settings.outputDirectory = app.getPath("videos");
  }

  return settings;
}

function getSettings() {
  return settings;
}

function saveSettings(newSettings) {
  if (newSettings) {
    settings = { ...settings, ...newSettings };
  }

  const filePath = getSettingsPath();
  try {
    const dirPath = path.dirname(filePath);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(settings, null, 2));
    return settings;
  } catch (err) {
    console.error("Failed to save settings:", err);
    return settings;
  }
}

function resetSettings() {
  const recentRecordings = settings.recentRecordings || [];
  settings = {
    ...DEFAULT_SETTINGS,
    recentRecordings: recentRecordings
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
