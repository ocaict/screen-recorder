const { Menu, Tray } = require("electron");
const path = require("path");
const { log } = require("../utils/logger");

let tray = null;
let mainWindow = null;
let ICON_PATH = null;

function setMainWindow(window) {
  mainWindow = window;
}

function setIconPath(iconPath) {
  ICON_PATH = iconPath;
}

function createTray() {
  if (tray) {
    tray.destroy();
    tray = null;
  }

  try {
    tray = new Tray(ICON_PATH);
    tray.setToolTip("Oca Screen Recorder");

    const contextMenu = Menu.buildFromTemplate([
      {
        label: "Show Recorder",
        click: () => {
          if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
          }
        },
      },
      {
        label: "Quit",
        click: () => {
          const { app } = require("electron");
          app.quit();
        },
      },
    ]);

    tray.setContextMenu(contextMenu);

    tray.on("click", () => {
      if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
      }
    });

    log("info", "System tray created");
  } catch (err) {
    log("error", `Failed to create tray: ${err.message}`);
  }
}

function createRecordingTray() {
  if (tray) {
    tray.destroy();
    tray = null;
  }

  try {
    tray = new Tray(ICON_PATH);
    tray.setToolTip("Recording...");

    const contextMenu = Menu.buildFromTemplate([
      {
        label: "Pause Recording",
        click: () => {
          if (mainWindow) {
            mainWindow.webContents.send("pause-recording-from-tray");
          }
        },
      },
      {
        label: "Stop Recording",
        click: () => {
          if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
            mainWindow.webContents.send("stop-recording-from-tray");
          }
        },
      },
      { type: "separator" },
      {
        label: "Show Recorder",
        click: () => {
          if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
          }
        },
      },
    ]);

    tray.setContextMenu(contextMenu);

    tray.on("click", () => {
      if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
      }
    });

    log("info", "Recording tray created");
  } catch (err) {
    log("error", `Failed to create recording tray: ${err.message}`);
  }
}

function createPausedTray() {
  if (tray) {
    tray.destroy();
    tray = null;
  }

  try {
    tray = new Tray(ICON_PATH);
    tray.setToolTip("Recording Paused");

    const contextMenu = Menu.buildFromTemplate([
      {
        label: "Resume Recording",
        click: () => {
          if (mainWindow) {
            mainWindow.webContents.send("resume-recording-from-tray");
          }
        },
      },
      {
        label: "Stop Recording",
        click: () => {
          if (mainWindow) {
            mainWindow.webContents.send("stop-recording-from-tray");
          }
        },
      },
      {
        label: "Show Recorder",
        click: () => {
          if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
          }
        },
      },
    ]);

    tray.setContextMenu(contextMenu);

    tray.on("click", () => {
      if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
      }
    });

    log("info", "Paused tray created");
  } catch (err) {
    log("error", `Failed to create paused tray: ${err.message}`);
  }
}

function restoreNormalTray() {
  if (tray) {
    tray.destroy();
    tray = null;
  }
  createTray();
}

function getTray() {
  return tray;
}

function destroyTray() {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}

module.exports = {
  setMainWindow,
  setIconPath,
  createTray,
  createRecordingTray,
  createPausedTray,
  restoreNormalTray,
  getTray,
  destroyTray,
};
