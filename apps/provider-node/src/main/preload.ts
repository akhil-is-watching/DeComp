/** The only bridge between the isolated renderer and Node/Electron APIs. Keep this surface tiny. */
import { contextBridge, ipcRenderer } from "electron";

const api = {
  getPrivyAppId: (): Promise<string | undefined> => ipcRenderer.invoke("decomp:get-privy-app-id"),
};

contextBridge.exposeInMainWorld("decomp", api);

export type DecompApi = typeof api;
