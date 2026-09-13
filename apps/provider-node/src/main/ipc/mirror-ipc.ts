import { ipcMain } from "electron";
import { fetchBalance, fetchProviderAudits } from "../mirror-reads";

export function registerMirrorIpc(): void {
  ipcMain.handle("decomp:get-balance", (_event, accountId: string, computeTokenId?: string) => fetchBalance(accountId, computeTokenId));
  ipcMain.handle("decomp:get-provider-audits", (_event, auditTopicId: string, accountId: string) => fetchProviderAudits(auditTopicId, accountId));
}
