import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, shell } from "electron";
import net from "node:net";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
// A fixed port keeps the page origin, and with it the saved layout and open tabs, stable between launches.
const PREFERRED_PORT = 47474;

let appUrl = "";

/** The preferred port if it is free, otherwise any free port. */
function freePort(preferred: number): Promise<number> {
  const tryListen = (port: number) =>
    new Promise<number>((resolve, reject) => {
      const probe = net.createServer();
      probe.once("error", reject);
      probe.listen(port, "127.0.0.1", () => {
        const { port: bound } = probe.address() as net.AddressInfo;
        probe.close(() => resolve(bound));
      });
    });
  return tryListen(preferred).catch(() => tryListen(0));
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 560,
    title: "Open LaTeX Compiler",
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#0b0b0b" : "#f6f6f4",
    show: false,
    webPreferences: { preload: path.join(DIR, "preload.cjs"), contextIsolation: true, sandbox: true },
  });
  win.once("ready-to-show", () => win.show());
  // Links to other sites (and "open in new tab") go to the default browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(appUrl)) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });
  void win.loadURL(appUrl);
}

async function start() {
  const port = await freePort(PREFERRED_PORT);
  process.env.PORT = String(port);
  process.env.NO_OPEN = "1";
  process.env.LATEXCOMPILE_DESKTOP = "1";
  // The server is a separate bundle so these variables are set before its modules load.
  const server = (await import(pathToFileURL(path.join(DIR, "server.mjs")).href)) as { ready: Promise<string> };
  const [url] = await Promise.all([server.ready, app.whenReady()]);
  appUrl = url;

  Menu.setApplicationMenu(
    Menu.buildFromTemplate([{ role: "appMenu" }, { role: "fileMenu" }, { role: "editMenu" }, { role: "viewMenu" }, { role: "windowMenu" }]),
  );
  ipcMain.on("desktop:theme", (_event, theme: string) => {
    nativeTheme.themeSource = theme === "light" ? "light" : "dark";
  });
  ipcMain.handle("desktop:pick-folder", async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const options: Electron.OpenDialogOptions = { title: "Open a folder as a project", buttonLabel: "Open", properties: ["openDirectory", "createDirectory"] };
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    return result.canceled ? null : result.filePaths[0];
  });

  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  // On macOS the app stays in the Dock after its window closes, like other Mac apps.
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
  start().catch((error: Error) => {
    dialog.showErrorBox("Open LaTeX Compiler could not start", error.stack ?? error.message);
    app.quit();
  });
}
