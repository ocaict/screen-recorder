const {
  app,
  BrowserWindow,
  Menu,
  ipcMain,
  desktopCapturer,
  dialog,
  Tray,
} = require("electron/main");
const { shell } = require("electron");

if (!app.isPackaged) {
  require("electron-reload")(__dirname, {
    electron: require(`${__dirname}/node_modules/electron`),
  });
}

const fs = require("fs");
const path = require("path");
const ffmpeg = require("fluent-ffmpeg");

const { getTimeDuration } = require("./helpers/helpers");
const ffmpegPath = app.isPackaged
  ? path.join(process.resourcesPath, "ffmpeg.exe")
  : require("ffmpeg-static");

ffmpeg.setFfmpegPath(ffmpegPath);

let mainWindow;
let trayMenu;
const trayIcon = path.join(__dirname, "appIcon.png");

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    transparent: true,
    frame: false,
    show: false,
    resizable: false,
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
        trayMenu.destroy();
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
    fetchWindowIcons: true,
  });

  return sources;
};

app.whenReady().then(async () => {
  createWindow();
});

const createMenu = (type) => {
  // Creating application menu
  let menuTemplate =
    type === "file"
      ? [
          {
            label: "about",
            click: () => {
              console.log("About");
            },
          },

          {
            label: "Quit",
            click: () => app.quit(),
          },
        ]
      : [
          {
            role: "toggleDevTools",
          },
          {
            role: "reload",
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
  const fileName = `newRecord_${Date.now().toString()}.mp4`;
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
  const tempFilePath = !app.isPackaged
    ? path.join(__dirname, "temp_video.webm")
    : path.join(app.getPath("temp"), "temp_video.webm");
  const writeStream = fs.createWriteStream(tempFilePath);
  const blob = Buffer.from(stream);
  writeStream.write(blob);

  // const time = await getTimeDuration(ffmpeg, tempFilePath);

  writeStream
    .end(() => {
      ffmpeg(tempFilePath)
        .outputOptions([
          "-c:v libx264",
          "-crf 18",
          "-preset slow",
          "-movflags +faststart",
          "-pix_fmt yuv420p",
          // "-vf fps=60,scale=1920:1080",
        ])
        .toFormat("mp4")
        .on("end", () => {
          console.log("Conversion finished");
          fs.unlink(tempFilePath, (err) => {
            if (err) {
              console.log(err);
              mainWindow.webContents.send("error-message", err);
              return;
            }
          });

          e.sender.send("conversion-complete", userPath);
          trayMenu.destroy();
          mainWindow.show();
        })
        .on("progress", (progress) => {
          mainWindow.webContents.send("conversion-progress", progress);
        })
        .on("error", (err) => {
          console.error("Error during conversion", err);
          mainWindow.webContents.send("error-message", err);
        })
        .save(userPath);
    })
    .on("error", (error) => {
      console.log(error);
      mainWindow.webContents.send("error-message", error);
    });
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
