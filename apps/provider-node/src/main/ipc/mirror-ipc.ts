import { ipcMain } from "electron";
import type { HederaNetwork } from "@decomp/hedera-x402";
import { fetchBalance, fetchProviderAudits, fetchRegistry } from "../mirror-reads";

export function registerMirrorIpc(): void {
  ipcMain.handle("decomp:get-balance", (_event, accountId: string, network: HederaNetwork, computeTokenId?: string) =>
    fetchBalance(accountId, network, computeTokenId),
  );
  ipcMain.handle("decomp:get-provider-audits", (_event, auditTopicId: string, accountId: string, network: HederaNetwork) =>
    fetchProviderAudits(auditTopicId, accountId, network),
  );
  ipcMain.handle("decomp:get-registry", (_event, registryTopicId: string, network: HederaNetwork) => fetchRegistry(registryTopicId, network));
}
