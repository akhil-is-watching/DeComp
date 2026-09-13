/**
 * Provider Node's main process. Electron's main process is Node.js, not Bun — no Bun.serve,
 * bun:sqlite, etc. here, even though the rest of this monorepo prefers Bun; see the plan doc.
 */
import { app, BrowserWindow, ipcMain } from "electron";
import { join } from "node:path";
import { getRootEnvValue, loadRootEnvIntoProcess } from "./env-config";
import { registerAccountProvisioningIpc } from "./ipc/account-provisioning-ipc";
import { registerEnvConfigIpc } from "./ipc/env-config-ipc";
import { registerMirrorIpc } from "./ipc/mirror-ipc";
import { registerSettingsIpc } from "./ipc/settings-ipc";

// Needed before anything below touches @decomp/privy-hedera (account-provisioning.ts's OPERATOR
// payer) — Electron's main process gets none of Bun's automatic .env loading.
loadRootEnvIntoProcess();

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

ipcMain.handle("decomp:get-privy-app-id", () => getRootEnvValue("PRIVY_APP_ID"));
registerSettingsIpc();
registerMirrorIpc();
registerEnvConfigIpc();
registerAccountProvisioningIpc();

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
