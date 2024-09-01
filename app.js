const { app, BrowserWindow, Menu, ipcMain } = require("electron/main");
const path = require("path");
let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    frame: false,
    show: false,
    icon: path.join(__dirname, "appIcon.png"),

    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
    },
  });

  mainWindow.loadFile(path.join(__dirname, "frontend", "index.html"));
  mainWindow.on("ready-to-show", () => mainWindow.show());
}

const createMainMenu = () => {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "File",
        submenu: [
          {
            role: "reload",
          },
          {
            role: "toggleDevTools",
          },
        ],
      },
    ])
  );
};
app.whenReady().then(() => {
  createWindow();
});

const createMenu = (type) => {
  // Creating application menu
  const menuTemplate = [
    {
      label: "Copy",
      click: () => {
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
  mainWindow.isMaximized() ? mainWindow.restore() : mainWindow.maximize();

  return mainWindow.isMaximized();
});

ipcMain.handle("close-app", () => {
  app.quit();
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
