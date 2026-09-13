/**
 * Read-only data for the Balance/Job History/Reward History screens — all public mirror-node and
 * HCS reads, no Privy login or signing involved at all. Reused directly from the existing
 * packages; nothing here is provider-node-specific logic.
 */
import { getHbarBalance, getTokenBalance, hederaNetwork } from "@decomp/hedera-x402";
import { readAudits, type AuditEntry } from "@decomp/hcs-registry";

export type BalanceSnapshot = { hbarTinybars: string; computeTokenUnits: string | null };

export async function fetchBalance(accountId: string, computeTokenId?: string): Promise<BalanceSnapshot> {
  const hbar = await getHbarBalance(accountId);
  const token = computeTokenId ? await getTokenBalance(accountId, computeTokenId) : null;
  return { hbarTinybars: hbar.toString(), computeTokenUnits: token === null ? null : token.toString() };
}

/** Every audit-topic entry where this account was the provider paid — the shared source for both Job History and Reward History. */
export async function fetchProviderAudits(auditTopicId: string, accountId: string): Promise<AuditEntry[]> {
  const entries = await readAudits(auditTopicId, { network: hederaNetwork() });
  return entries.filter(e => e.provider.account === accountId).sort((a, b) => (a.consensusTimestamp < b.consensusTimestamp ? 1 : -1));
}
