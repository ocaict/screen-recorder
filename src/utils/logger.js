const fs = require("fs");
const path = require("path");
const { app } = require("electron");

let logFile = null;
let logStream = null;

function setupLogger() {
  try {
    const logDir = app.isPackaged
      ? path.join(app.getPath("userData"), "logs")
      : path.join(__dirname, "..", "..", "logs");
    
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    
    const date = new Date().toISOString().split("T")[0];
    logFile = path.join(logDir, `app_${date}.log`);
    
    logStream = fs.createWriteStream(logFile, { flags: "a" });
    
    log("info", "Logger initialized");
  } catch (err) {
    console.error("Failed to setup logger:", err);
  }
}

function formatMessage(level, message) {
  const timestamp = new Date().toISOString();
  return `[${timestamp}] [${level.toUpperCase()}] ${message}\n`;
}

function log(level, message) {
  const formatted = formatMessage(level, message);
  
  console.log(formatted.trim());
  
  if (logStream) {
    logStream.write(formatted);
  }
}

function logError(message, stack) {
  const formatted = formatMessage("error", message);
  if (stack) {
    log("error", `${message}\n${stack}`);
  } else {
    log("error", message);
  }
}

module.exports = {
  setupLogger,
  log,
  logError,
};
