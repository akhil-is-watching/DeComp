import { currentRegistrations, readRegistry, type RegistryEntry } from "@decomp/hcs-registry";
import { hederaNetwork } from "@decomp/hedera-x402";
import type { Candidate } from "./router";

/** Providers whose current registration offers `jobType`, priced at their offer for that job type. */
export function offersFor(entries: RegistryEntry[], jobType: string, network: string): Candidate[] {
  return currentRegistrations(entries, network).flatMap(entry => {
    const offer = entry.jobTypes.find(o => o.name === jobType);
    return offer
      ? [
          {
            providerId: entry.providerId,
            hederaAccount: entry.hederaAccount,
            endpoint: entry.endpoint,
            pricePerSecTinybars: BigInt(offer.pricePerSecTinybars),
            tickSeconds: offer.tickSeconds,
            registeredAt: entry.consensusTimestamp,
          },
        ]
      : [];
  });
}

export async function discoverProviders(topicId: string, jobType: string): Promise<Candidate[]> {
  const network = hederaNetwork();
  return offersFor(await readRegistry(topicId, { network }), jobType, network);
}

/**
 * A registration on HCS is a durable record — it stays there long after whoever published it has
 * gone offline. Whether a candidate is actually worth listing depends on whether its GPU runner is
 * answering right now, which only its own /health endpoint (see apps/provider/src/index.ts) knows.
 */
async function runnerIsLive(endpoint: string, timeoutMs = 3_000): Promise<boolean> {
  try {
    const res = await fetch(`${endpoint.replace(/\/$/, "")}/health`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return false;
    const body = (await res.json()) as { runner?: boolean };
    return body.runner === true;
  } catch {
    return false;
  }
}

/** Same candidates as {@link discoverProviders}, filtered to ones whose runner answers right now. */
export async function discoverLiveProviders(topicId: string, jobType: string): Promise<Candidate[]> {
  const candidates = await discoverProviders(topicId, jobType);
  const live = await Promise.all(candidates.map(c => runnerIsLive(c.endpoint)));
  return candidates.filter((_, i) => live[i]);
}
