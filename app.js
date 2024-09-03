const {
  app,
  BrowserWindow,
  Menu,
  ipcMain,
  desktopCapturer,
  dialog,
  Tray,
} = require("electron/main");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");
const fs = require("fs");

const path = require("path");
const { shell } = require("electron");
let mainWindow;
let trayMenu;
const trayIcon = path.join(__dirname, "appIcon.png");

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    minWidth: 400,
    minHeight: 400,
    maxWidth: 800,
    maxHeight: 600,
    transparent: true,
    frame: false,
    show: false,
    resizable: true,
    icon: path.join(__dirname, "appIcon.png"),

    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "frontend", "index.html"));
  mainWindow.on("ready-to-show", () => mainWindow.show());
}

const createTrayMenu = () => {
  // Tray menu
  const menu = Menu.buildFromTemplate([
    {
      label: "Stop Recording",
      click: () => {
        mainWindow.webContents.send("stop-recorder");
        console.log("Stop!...");
      },
    },
    {
      label: "Show Recorder",
      click: () => {
        mainWindow.show();
      },
    },
  ]);

  trayMenu = new Tray(trayIcon);
  trayMenu.setContextMenu(menu);
  trayMenu.setToolTip("Recording");

  trayMenu.getTitle("OcaMedia Capture");
  trayMenu.addListener("click", (e) => {
    trayMenu.focus();
  });
};

const getCaptureSources = async () => {
  const sources = await desktopCapturer.getSources({
    types: ["window", "screen"],
  });

  return sources;
};

app.whenReady().then(async () => {
  createWindow();
});

const createMenu = (type) => {
  // Creating application menu
  const menuTemplate = [
    {
      label: "Copy",
      click: async () => {
        mainWindow.webContents.send("copy");
      },
    },
    {
      label: "Always On Top",
      type: "checkbox",
      checked: false,

      click: (e) => {
        mainWindow.setAlwaysOnTop(true);
        console.log(e.checked);
      },
    },

    {
      label: "about",
      click: () => {
        console.log("About");
      },
    },
    {
      role: "reload",
    },
    {
      role: "toggleDevTools",
    },
    {
      label: "Quit",
      click: () => app.quit(),
    },
  ];
  // Building application menu from template
  const menu = Menu.buildFromTemplate(menuTemplate);

  // Setting application menu
  Menu.setApplicationMenu(menu);
  let x = type === "file" ? 10 : 10 + 40;
  let y = 24 + 24;

  menu.popup({ x, y });
};

// IPC HANDLERS
ipcMain.handle("open-file-menu", (_, type) => {
  createMenu(type);

  return "Menu Created";
});

ipcMain.handle("open-edit-menu", (_, type) => {
  createFileMenu(type);

  return "Menu Created";
});
ipcMain.handle("minimize-window", () => {
  mainWindow.minimize();
});

ipcMain.handle("restore-maximize-window", () => {
  mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();

  return mainWindow.isMaximized();
});

ipcMain.handle("close-app", () => {
  app.quit();
});

const selectSource = (source) => {
  mainWindow.webContents.send("source", source);
};
ipcMain.handle("get-capture-sources", async () => {
  const sources = await getCaptureSources();
  const menu = Menu.buildFromTemplate(
    sources.map((source) => {
      return {
        label: source.name,
        click: () => selectSource(source),
      };
    })
  );
  menu.popup();
});

ipcMain.handle("handle-stream", async (e, stream) => {
  const fileName = `newRecord_${Date.now().toString()}.mp4`; // You may change the file name and extension
  const filePath = __dirname + "/records/" + fileName;
  const userPath = dialog.showSaveDialogSync(mainWindow, {
    defaultPath: `${filePath}`,
    filters: [{ name: "Movies", extensions: ["mp4"] }],
  });

  if (!userPath) {
    mainWindow.webContents.send("record-terminated");
    trayMenu.destroy();

    return;
  }

  const tempFilePath = "temp_video.webm";
  const writeStream = fs.createWriteStream(tempFilePath);
  const blob = Buffer.from(stream);
  writeStream.write(blob);

  writeStream
    .end(() => {
      ffmpeg(tempFilePath)
        .setFfmpegPath(ffmpegPath)
        .toFormat("mp4")
        .on("end", () => {
          console.log("Conversion finished");
          fs.unlink(tempFilePath, (err) => {
            if (err) return console.log(err);
          });
          e.sender.send("conversion-complete", userPath);
          trayMenu.destroy();
          mainWindow.show();
        })
        .on("error", (err) => {
          console.error("Error during conversion", err);
        })
        .save(userPath);
    })
    .on("error", (error) => console.log(error));
});

ipcMain.handle("hide-recorder", () => {
  mainWindow.hide();
});

ipcMain.handle("show-recorder", () => {
  mainWindow.show();
});
ipcMain.handle("create-tray-menu", () => {
  createTrayMenu();
});

ipcMain.handle("get-default-source", async (e) => {
  const sources = await getCaptureSources();
  const defaultSource = sources.find((source) => source.id === "screen:0:0");
  return defaultSource;
});
ipcMain.handle("open-recorded-location", async (e, location) => {
  const result = shell.showItemInFolder(location);
  console.log(result);
});
ipcMain.handle("play-with-default-player", async (e, location) => {
  const result = await shell.openPath(location);
  console.log(result);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
