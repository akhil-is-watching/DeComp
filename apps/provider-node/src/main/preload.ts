/** The only bridge between the isolated renderer and Node/Electron APIs. Keep this surface tiny. */
import { contextBridge, ipcRenderer } from "electron";
import type { RegistryEntry } from "@decomp/hcs-registry";
import type { HederaNetwork } from "@decomp/hedera-x402";
import type { ProvisionResult } from "./account-provisioning";
import type { RegistrationRequest, RegistrationResult } from "./provider-registration";
import type { NodeRunState, ProcessName, RunnerPathStatus, RunnerSetupResult } from "./node-supervisor";
import type { EnvConfig } from "./env-config";
import type { BalanceSnapshot, ProviderAudits } from "./mirror-reads";
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
  getBalance: (accountId: string, network: HederaNetwork, computeTokenId?: string): Promise<BalanceSnapshot> =>
    ipcRenderer.invoke("decomp:get-balance", accountId, network, computeTokenId),
  getProviderAudits: (auditTopicId: string, accountId: string, network: HederaNetwork): Promise<ProviderAudits> =>
    ipcRenderer.invoke("decomp:get-provider-audits", auditTopicId, accountId, network),
  /** Every provider currently listed on the registry topic — this node's own listing included. */
  getRegistry: (registryTopicId: string, network: HederaNetwork): Promise<RegistryEntry[]> =>
    ipcRenderer.invoke("decomp:get-registry", registryTopicId, network),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke("decomp:open-external", url),
  /** Starts/stops the GPU runner and provider that make a listed node actually answer jobs. */
  startNode: (): Promise<NodeRunState> => ipcRenderer.invoke("decomp:start-node"),
  stopNode: (): Promise<void> => ipcRenderer.invoke("decomp:stop-node"),
  getNodeState: (): Promise<NodeRunState> => ipcRenderer.invoke("decomp:node-state"),
  getNodeLog: (): Promise<{ name: ProcessName; line: string; at: number }[]> => ipcRenderer.invoke("decomp:node-log"),
  /** Same check Start runs, exposed so Settings/Engine can point out a bad path before the user tries. */
  checkRunnerPath: (runnerPath: string | null): Promise<RunnerPathStatus> => ipcRenderer.invoke("decomp:check-runner-path", runnerPath),
  /** Creates the job runner's Python environment, so setup never needs a terminal. Slow: it downloads Python and PyTorch. */
  setupRunner: (): Promise<RunnerSetupResult> => ipcRenderer.invoke("decomp:setup-runner"),
  onNodeChanged: (listener: (state: NodeRunState) => void): (() => void) => {
    const handler = (_event: unknown, state: NodeRunState) => listener(state);
    ipcRenderer.on("decomp:node-changed", handler);
    return () => ipcRenderer.removeListener("decomp:node-changed", handler);
  },
  getEnvConfig: (): Promise<EnvConfig> => ipcRenderer.invoke("decomp:get-env-config"),
  provisionAccount: (address: string, associateTokenIds: string[]): Promise<ProvisionResult> =>
    ipcRenderer.invoke("decomp:provision-account", address, associateTokenIds),
  /** Publishes this node's listing to the registry topic, signed by the embedded wallet. */
  registerProvider: (request: RegistrationRequest): Promise<RegistrationResult> =>
    ipcRenderer.invoke("decomp:register-provider", request),
};

contextBridge.exposeInMainWorld("decomp", api);

export type DecompApi = typeof api;
