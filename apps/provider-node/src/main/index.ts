/**
 * Provider Node's main process. Electron's main process is Node.js, not Bun — no Bun.serve,
 * bun:sqlite, etc. here, even though the rest of this monorepo prefers Bun; see the plan doc.
 *
 * Right now this only boots the window and hands the renderer its one public config value
 * (PRIVY_APP_ID). Everything else — provider process management, the embedded-wallet signing
 * bridge, mirror/HCS reads — lands in later steps of the build; see docs/BUILD_PLAN equivalent
 * (the plan file this app was built from).
 */
import { app, BrowserWindow, ipcMain } from "electron";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** The monorepo root .env — Electron's main process gets none of Bun's automatic .env loading. */
function loadRootEnv(key: string): string | undefined {
  try {
    const text = readFileSync(join(__dirname, "../../../../.env"), "utf8");
    return text.match(new RegExp(`^${key}=(.*)$`, "m"))?.[1]?.trim();
  } catch {
    return undefined;
  }
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1080,
    height: 720,
    show: false,
    webPreferences: {
      // electron-vite names build output after the source file's own basename: src/main/preload.ts -> out/preload/preload.js.
      preload: join(__dirname, "../preload/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // the preload script needs Node's ipcRenderer; the renderer content itself stays isolated
    },
  });
  win.once("ready-to-show", () => win.show());

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

ipcMain.handle("decomp:get-privy-app-id", () => loadRootEnv("PRIVY_APP_ID"));

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
