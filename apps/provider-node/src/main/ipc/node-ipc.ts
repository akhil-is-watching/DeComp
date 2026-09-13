import { BrowserWindow, ipcMain } from "electron";
import { loadSettings } from "../settings-store";
import { nodeLog, nodeState, onNodeChange, startNode, stopNode } from "../node-supervisor";

export function registerNodeIpc(): void {
  ipcMain.handle("decomp:node-state", () => nodeState());
  ipcMain.handle("decomp:node-log", () => nodeLog());
  ipcMain.handle("decomp:stop-node", () => stopNode());
  ipcMain.handle("decomp:start-node", async event => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) throw new Error("no window for this request");
    await startNode(win, loadSettings());
    return nodeState();
  });

  // Pushed rather than polled: the interesting transitions (bridge connected, a process died)
  // happen on the child's schedule, not the renderer's.
  onNodeChange(() => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send("decomp:node-changed", nodeState());
    }
  });
}
