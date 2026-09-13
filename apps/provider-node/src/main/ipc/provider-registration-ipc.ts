import { BrowserWindow, ipcMain } from "electron";
import { registerProviderForSigner, type RegistrationRequest } from "../provider-registration";
import { createWindowSigner } from "../identity/renderer-signer";

export function registerProviderRegistrationIpc(): void {
  ipcMain.handle("decomp:register-provider", (event, request: RegistrationRequest) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) throw new Error("no window for this request");
    // Publishing needs several signatures (one per consensus node body), so allow longer than the
    // default before giving up on the renderer.
    return registerProviderForSigner(createWindowSigner(win, 60_000), request);
  });
}
