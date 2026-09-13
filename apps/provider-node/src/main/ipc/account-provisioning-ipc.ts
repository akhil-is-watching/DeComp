import { BrowserWindow, ipcMain } from "electron";
import { provisionAccountForSigner } from "../account-provisioning";
import { createWindowSigner } from "../identity/renderer-signer";

export function registerAccountProvisioningIpc(): void {
  ipcMain.handle("decomp:provision-account", (event, address: string, associateTokenIds: string[]) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) throw new Error("no window for this request");
    return provisionAccountForSigner(createWindowSigner(win), address, associateTokenIds);
  });
}
