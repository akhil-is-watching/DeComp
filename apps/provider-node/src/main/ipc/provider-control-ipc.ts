import { BrowserWindow, ipcMain } from "electron";
import type { HederaNetwork } from "@decomp/hedera-x402";
import { createEmbeddedWalletIdentity } from "../identity/embedded-wallet-identity";
import { createWindowSigner } from "../identity/renderer-signer";
import { getProviderStatus, startProviderProcess, stopProviderProcess, type ProviderStatus } from "../provider-process";
import { startNetworkPresence, type NetworkPresence } from "../network-presence";

export type StartProviderOptions = {
  accountId: string;
  address: string;
  providerName: string;
  port: number;
  offersSpec: string;
  tickSeconds: number;
  tickGraceSeconds: number;
  maxRuntimeS: number;
  jobRunnerUrl: string;
  bridgeUrl?: string;
  registryTopicId?: string;
  computeTokenId?: string;
  network: HederaNetwork;
};

let presence: NetworkPresence | null = null;

async function waitForHealthy(url: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(2_000) })).ok) return true;
    } catch {
      // not up yet
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  return false;
}

export function registerProviderControlIpc(): void {
  ipcMain.handle("decomp:start-provider", async (event, options: StartProviderOptions) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) throw new Error("no window for this request");
    if (getProviderStatus().running) throw new Error("the provider is already running");

    const log = (line: string) => win.webContents.send("decomp:provider-log", line);
    const sign = createWindowSigner(win);
    const identity = await createEmbeddedWalletIdentity(sign, options.accountId, options.address, options.network);

    await startProviderProcess(
      {
        providerName: options.providerName,
        port: options.port,
        accountId: options.accountId,
        offers: options.offersSpec,
        tickSeconds: options.tickSeconds,
        tickGraceSeconds: options.tickGraceSeconds,
        maxRuntimeS: options.maxRuntimeS,
        jobRunnerUrl: options.jobRunnerUrl,
        network: options.network,
        computeTokenId: options.computeTokenId,
      },
      log,
    );

    const healthy = await waitForHealthy(`http://127.0.0.1:${options.port}/health`, 30_000);
    if (!healthy) {
      stopProviderProcess();
      throw new Error("the provider did not become healthy — is the GPU job runner reachable at " + options.jobRunnerUrl + "?");
    }

    presence = startNetworkPresence({
      identity,
      providerName: options.providerName,
      publicPort: options.port,
      bridgeUrl: options.bridgeUrl,
      registryTopicId: options.registryTopicId,
      offersSpec: options.offersSpec,
      tickSeconds: options.tickSeconds,
      network: options.network,
      log,
    });

    return { started: true };
  });

  ipcMain.handle("decomp:stop-provider", () => {
    presence?.stop();
    presence = null;
    stopProviderProcess();
    return { stopped: true };
  });

  ipcMain.handle("decomp:get-provider-status", (): ProviderStatus => getProviderStatus());
}
