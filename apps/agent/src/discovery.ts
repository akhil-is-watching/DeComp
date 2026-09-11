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
            priceTinybars: BigInt(offer.priceTinybars),
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
