/**
 * The Electron-specific half of embedded-wallet signing: main asks, the already-logged-in
 * renderer's Privy session answers. Kept separate from embedded-wallet-identity.ts's pure signing
 * math so that module has zero Electron dependency and can be unit-tested without a real window.
 */
import { ipcMain, type BrowserWindow } from "electron";
import type { RawSigner } from "./embedded-wallet-identity";

type SignResponse = { ok: true; signatureHex: string } | { ok: false; error: string };

/** A RawSigner that asks `win`'s renderer to sign, over IPC (see preload.ts for the other end). */
export function createWindowSigner(win: BrowserWindow, timeoutMs = 20_000): RawSigner {
  return digest =>
    new Promise<Uint8Array>((resolve, reject) => {
      const id = crypto.randomUUID();
      const channel = `decomp:sign-response:${id}`;
      const timer = setTimeout(() => {
        ipcMain.removeAllListeners(channel);
        reject(new Error("the renderer did not answer the sign request in time — is it logged in?"));
      }, timeoutMs);

      ipcMain.once(channel, (_event, result: SignResponse) => {
        clearTimeout(timer);
        if (result.ok) resolve(Buffer.from(result.signatureHex.replace(/^0x/, ""), "hex"));
        else reject(new Error(result.error));
      });

      win.webContents.send("decomp:sign-request", { id, hashHex: `0x${Buffer.from(digest).toString("hex")}` });
    });
}
