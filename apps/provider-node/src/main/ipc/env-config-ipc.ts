import { ipcMain } from "electron";
import { getEnvConfig } from "../env-config";

export function registerEnvConfigIpc(): void {
  ipcMain.handle("decomp:get-env-config", () => getEnvConfig());
}
