const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

function createLinuxDesktopShortcut() {
  if (process.platform !== "linux") return;
  try {
    const desktopPath = app.getPath("desktop");
    const shortcutPath = path.join(desktopPath, "resenha-chat.desktop");
    if (fs.existsSync(shortcutPath)) return;
    const iconPath = path.join(app.getPath("home"), ".local", "share", "icons", "hicolor", "512x512", "apps", "resenha-chat.png");
    fs.mkdirSync(path.dirname(iconPath), { recursive: true });
    fs.copyFileSync(path.join(app.getAppPath(), "dist", "public", "icon-512.png"), iconPath);
    const executable = process.env.APPIMAGE || process.execPath;
    const content = `[Desktop Entry]\nType=Application\nName=Resenha Chat\nComment=Converse, ligue e compartilhe\nExec="${executable}" %U\nIcon=${iconPath}\nTerminal=false\nCategories=Network;Chat;\n`;
    fs.writeFileSync(shortcutPath, content, { mode: 0o755 });
  } catch {
    // O app continua funcional se o ambiente Linux não permitir criar o atalho.
  }
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 620,
    backgroundColor: "#10121a",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.loadFile(path.join(app.getAppPath(), "dist", "public", "index.html"));
}

app.whenReady().then(() => {
  createLinuxDesktopShortcut();
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
