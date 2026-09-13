/**
 * Provider Node's main process. Electron's main process is Node.js, not Bun — no Bun.serve,
 * bun:sqlite, etc. here, even though the rest of this monorepo prefers Bun; see the plan doc.
 */
import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join } from "node:path";
import { getRootEnvValue, loadRootEnvIntoProcess } from "./env-config";
import { registerAccountProvisioningIpc } from "./ipc/account-provisioning-ipc";
import { registerEnvConfigIpc } from "./ipc/env-config-ipc";
import { registerMirrorIpc } from "./ipc/mirror-ipc";
import { registerProviderControlIpc } from "./ipc/provider-control-ipc";
import { registerSettingsIpc } from "./ipc/settings-ipc";
import { stopProviderProcess } from "./provider-process";

// Needed before anything below touches @decomp/privy-hedera (account-provisioning.ts's OPERATOR
// payer) — Electron's main process gets none of Bun's automatic .env loading.
loadRootEnvIntoProcess();

// Packaged builds used to load the renderer via loadFile (a file:// origin). Privy's OAuth login
// (Google) finishes with a postMessage back to the origin that opened it, and Privy's dashboard
// allowed-origins list only accepts http(s) origins — file:// can never receive that handshake.
// Serving the built renderer over a fixed loopback origin instead gives Google login a real
// origin to whitelist. This port must be registered in the Privy dashboard as an allowed origin
// (http://127.0.0.1:<port>); override it with PROVIDER_NODE_RENDERER_PORT if it collides locally.
const RENDERER_PORT = Number(process.env.PROVIDER_NODE_RENDERER_PORT ?? 47813);

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json",
};

function serveRendererDir(dir: string, port: number): Promise<void> {
  const server = createServer((req, res) => {
    const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    const filePath = join(dir, pathname === "/" ? "index.html" : decodeURIComponent(pathname));
    readFile(filePath)
      .then(body => {
        res.writeHead(200, { "content-type": MIME_TYPES[extname(filePath)] ?? "application/octet-stream" });
        res.end(body);
      })
      .catch(() => {
        res.writeHead(404);
        res.end();
      });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });
}

async function createWindow(): Promise<void> {
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

  // Privy's Google login opens a popup (window.open) to auth.privy.io and expects to complete a
  // postMessage handshake with this window once it's done — Electron denies all popups by default,
  // so without this the button would silently do nothing. Only privy.io is allowed to pop up;
  // everything else stays denied.
  win.webContents.setWindowOpenHandler(({ url }) => {
    const host = new URL(url).hostname;
    return host === "privy.io" || host.endsWith(".privy.io") ? { action: "allow" } : { action: "deny" };
  });
  // Electron's default UA embeds "Electron/<version>", which Google's OAuth flags as a disallowed
  // embedded webview and refuses to sign in from — even though this popup is a genuine, separate
  // Chromium window fully capable of completing the postMessage handshake back to us. Stripping the
  // app-name and Electron tokens leaves a plain Chrome UA Google accepts, without touching the main
  // window's UA (session-wide overrides would affect every request the app makes).
  win.webContents.on("did-create-window", popup => {
    const chromeUa = win.webContents
      .getUserAgent()
      .replace(`${app.getName()}/${app.getVersion()} `, "")
      .replace(`Electron/${process.versions.electron} `, "");
    popup.webContents.setUserAgent(chromeUa);
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
    return;
  }
  try {
    await serveRendererDir(join(__dirname, "../renderer"), RENDERER_PORT);
  } catch (err) {
    dialog.showErrorBox(
      "Provider Node failed to start",
      `Couldn't bind the renderer server on 127.0.0.1:${RENDERER_PORT} (${err instanceof Error ? err.message : String(err)}). Set PROVIDER_NODE_RENDERER_PORT to a free port and restart.`,
    );
    app.quit();
    return;
  }
  win.loadURL(`http://127.0.0.1:${RENDERER_PORT}/`);
}

ipcMain.handle("decomp:get-privy-app-id", () => getRootEnvValue("PRIVY_APP_ID"));
registerSettingsIpc();
registerMirrorIpc();
registerEnvConfigIpc();
registerAccountProvisioningIpc();
registerProviderControlIpc();

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// The spawned provider child isn't a subprocess of Electron's own lifecycle — it keeps running
// (and holding its port) past a normal quit, and past electron-vite dev's main-process restart on
// every source change, unless stopped explicitly here. Both handlers matter: `before-quit` covers
// a real app quit, `exit` covers dev's restart, which doesn't always go through Electron's own
// quit flow.
app.on("before-quit", () => stopProviderProcess());
process.on("exit", () => stopProviderProcess());
