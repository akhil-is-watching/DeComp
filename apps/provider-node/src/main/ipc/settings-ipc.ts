import { ipcMain } from "electron";
import { loadSettings, saveSettings, type Settings } from "../settings-store";

export function registerSettingsIpc(): void {
  ipcMain.handle("decomp:get-settings", () => loadSettings());
  ipcMain.handle("decomp:save-settings", (_event, patch: Partial<Settings>) => saveSettings(patch));
}
