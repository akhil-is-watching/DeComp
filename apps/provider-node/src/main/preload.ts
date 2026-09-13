/** The only bridge between the isolated renderer and Node/Electron APIs. Keep this surface tiny. */
import { contextBridge, ipcRenderer } from "electron";
import type { AuditEntry } from "@decomp/hcs-registry";
import type { ProvisionResult } from "./account-provisioning";
import type { EnvConfig } from "./env-config";
import type { BalanceSnapshot } from "./mirror-reads";
import type { ProviderStatus } from "./provider-process";
import type { StartProviderOptions } from "./ipc/provider-control-ipc";
import type { Settings } from "./settings-store";

type SignResponse = { ok: true; signatureHex: string } | { ok: false; error: string };
type SignHandler = (hashHex: string) => Promise<SignResponse>;

// A module-level slot rather than re-registering an ipcRenderer listener per React render: the one
// permanent listener below just calls whatever handler is currently set (or none, pre-login).
let signHandler: SignHandler | null = null;

/** Waits briefly for setSignHandler to register — it's a React effect, so it can genuinely lose
 * the race against main's very first sign request (e.g. auto-provisioning firing the instant an
 * embedded wallet appears), not just be permanently absent. */
async function waitForSignHandler(timeoutMs = 5_000): Promise<SignHandler | null> {
  const deadline = Date.now() + timeoutMs;
  while (!signHandler && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return signHandler;
}

ipcRenderer.on("decomp:sign-request", (_event, payload: { id: string; hashHex: string }) => {
  const respond = (result: SignResponse) => ipcRenderer.send(`decomp:sign-response:${payload.id}`, result);
  waitForSignHandler()
    .then(handler => {
      if (!handler) throw new Error("no embedded wallet is available in the renderer yet");
      return handler(payload.hashHex);
    })
    .then(respond)
    .catch((error: unknown) => respond({ ok: false, error: error instanceof Error ? error.message : String(error) }));
});

const api = {
  getPrivyAppId: (): Promise<string | undefined> => ipcRenderer.invoke("decomp:get-privy-app-id"),
  /** Registers (or clears, with `null`) the renderer's current ability to answer a sign request. */
  setSignHandler: (handler: SignHandler | null): void => {
    signHandler = handler;
  },
  getSettings: (): Promise<Settings> => ipcRenderer.invoke("decomp:get-settings"),
  saveSettings: (patch: Partial<Settings>): Promise<Settings> => ipcRenderer.invoke("decomp:save-settings", patch),
  getBalance: (accountId: string, computeTokenId?: string): Promise<BalanceSnapshot> =>
    ipcRenderer.invoke("decomp:get-balance", accountId, computeTokenId),
  getProviderAudits: (auditTopicId: string, accountId: string): Promise<AuditEntry[]> =>
    ipcRenderer.invoke("decomp:get-provider-audits", auditTopicId, accountId),
  getEnvConfig: (): Promise<EnvConfig> => ipcRenderer.invoke("decomp:get-env-config"),
  provisionAccount: (address: string, associateTokenIds: string[]): Promise<ProvisionResult> =>
    ipcRenderer.invoke("decomp:provision-account", address, associateTokenIds),
  startProvider: (options: StartProviderOptions): Promise<{ started: true }> => ipcRenderer.invoke("decomp:start-provider", options),
  stopProvider: (): Promise<{ stopped: true }> => ipcRenderer.invoke("decomp:stop-provider"),
  getProviderStatus: (): Promise<ProviderStatus> => ipcRenderer.invoke("decomp:get-provider-status"),
  /** Subscribes to streamed provider/bridge log lines; returns an unsubscribe function. */
  onProviderLog: (callback: (line: string) => void): (() => void) => {
    const listener = (_event: unknown, line: string) => callback(line);
    ipcRenderer.on("decomp:provider-log", listener);
    return () => ipcRenderer.removeListener("decomp:provider-log", listener);
  },
};

contextBridge.exposeInMainWorld("decomp", api);

export type DecompApi = typeof api;
