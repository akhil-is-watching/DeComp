/**
 * Read-only data for the dashboard — all public mirror-node and HCS reads, no Privy login or
 * signing involved at all. Reused directly from the existing packages; nothing here is
 * provider-node-specific logic.
 *
 * Every read takes the network explicitly rather than falling back to hederaNetwork(), which
 * reads HEDERA_NETWORK out of the process env. That fallback made the network switch in Settings
 * a lie: it moved the explorer links and the badge while every balance and audit kept being read
 * from whichever network the .env happened to name. The user's setting is the authority now.
 */
import { getHbarBalance, getTokenBalance, type HederaNetwork } from "@decomp/hedera-x402";
import { currentRegistrations, readAudits, readRegistry, type AuditEntry, type RegistryEntry } from "@decomp/hcs-registry";

export type BalanceSnapshot = { hbarTinybars: string; computeTokenUnits: string | null };

export async function fetchBalance(accountId: string, network: HederaNetwork, computeTokenId?: string): Promise<BalanceSnapshot> {
  const hbar = await getHbarBalance(accountId, network);
  const token = computeTokenId ? await getTokenBalance(accountId, computeTokenId, network) : null;
  return { hbarTinybars: hbar.toString(), computeTokenUnits: token === null ? null : token.toString() };
}

/** What the whole market did recently — the answer to "is anyone actually buying?". */
export type NetworkActivity = { jobs24h: number; paidTinybars24h: string; earningNodes24h: number };

export type ProviderAudits = { entries: AuditEntry[]; network: NetworkActivity };

/**
 * This account's audit entries, plus a summary of everyone else's from the same read. One topic
 * fetch answers both "what have I earned" and "what am I missing" — worth having, because a node
 * that isn't listed or isn't running has no other way to see that the market is live.
 */
export async function fetchProviderAudits(auditTopicId: string, accountId: string, network: HederaNetwork): Promise<ProviderAudits> {
  const all = await readAudits(auditTopicId, { network });
  const since = Date.now() - 86_400_000;
  const recent = all.filter(e => Number(e.consensusTimestamp.split(".")[0]) * 1000 >= since);

  return {
    entries: all
      .filter(e => e.provider.account === accountId)
      .sort((a, b) => (a.consensusTimestamp < b.consensusTimestamp ? 1 : -1)),
    network: {
      jobs24h: recent.length,
      paidTinybars24h: recent.reduce((sum, e) => sum + BigInt(e.totalPaid), 0n).toString(),
      earningNodes24h: new Set(recent.map(e => e.provider.account)).size,
    },
  };
}

/**
 * Every provider currently advertised on the registry topic — authenticated (the account that
 * paid for the message is the one it advertises), newest per account, this network only. The
 * dashboard reads its own listing out of this, and uses the rest as the market to rank against.
 */
export async function fetchRegistry(registryTopicId: string, network: HederaNetwork): Promise<RegistryEntry[]> {
  return currentRegistrations(await readRegistry(registryTopicId, { network }), network);
}
