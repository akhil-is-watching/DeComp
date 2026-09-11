/**
 * Provider registrations on the HCS registry topic: one JSON message per registration, newest
 * per account wins. A registration only counts when the account that paid for the HCS message
 * is the account it advertises, so nobody can register someone else's payout account.
 */

export const REGISTRATION_SCHEMA = "decomp/provider-registration@1";

export type JobTypeOffer = { name: string; priceTinybars: string };

export type ProviderRegistration = {
  schema: typeof REGISTRATION_SCHEMA;
  providerId: string;
  hederaAccount: string;
  endpoint: string;
  network: string;
  jobTypes: JobTypeOffer[];
  publishedAt: string;
};

/** A registration as observed on the topic, with the consensus metadata the mirror node attaches. */
export type RegistryEntry = ProviderRegistration & {
  consensusTimestamp: string;
  sequenceNumber: number;
  payerAccountId: string;
};

const ACCOUNT_ID = /^\d+\.\d+\.\d+$/;
const JOB_TYPE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function parseRegistration(value: unknown): ProviderRegistration | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (v.schema !== REGISTRATION_SCHEMA) return null;
  if (typeof v.providerId !== "string" || v.providerId.length === 0 || v.providerId.length > 64) return null;
  if (typeof v.hederaAccount !== "string" || !ACCOUNT_ID.test(v.hederaAccount)) return null;
  if (typeof v.network !== "string" || typeof v.publishedAt !== "string") return null;
  if (typeof v.endpoint !== "string") return null;
  try {
    if (!["http:", "https:"].includes(new URL(v.endpoint).protocol)) return null;
  } catch {
    return null;
  }
  if (!Array.isArray(v.jobTypes) || v.jobTypes.length === 0) return null;
  const jobTypes: JobTypeOffer[] = [];
  for (const offer of v.jobTypes as unknown[]) {
    const o = offer as Record<string, unknown> | null;
    if (!o || typeof o.name !== "string" || !JOB_TYPE.test(o.name)) return null;
    if (typeof o.priceTinybars !== "string" || !/^\d+$/.test(o.priceTinybars) || BigInt(o.priceTinybars) <= 0n) return null;
    jobTypes.push({ name: o.name, priceTinybars: o.priceTinybars });
  }
  return {
    schema: REGISTRATION_SCHEMA,
    providerId: v.providerId,
    hederaAccount: v.hederaAccount,
    endpoint: v.endpoint,
    network: v.network,
    jobTypes,
    publishedAt: v.publishedAt,
  };
}

/** Orders `seconds.nanoseconds` consensus timestamps numerically. */
export function compareTimestamps(a: string, b: string): number {
  const [as = "0", an = "0"] = a.split(".");
  const [bs = "0", bn = "0"] = b.split(".");
  const diff = BigInt(as) - BigInt(bs) || BigInt(an.padEnd(9, "0")) - BigInt(bn.padEnd(9, "0"));
  return diff < 0n ? -1 : diff > 0n ? 1 : 0;
}

/** Authenticated, network-matching, newest registration per Hedera account. */
export function currentRegistrations(entries: RegistryEntry[], network: string): RegistryEntry[] {
  const latest = new Map<string, RegistryEntry>();
  for (const entry of entries) {
    if (entry.network !== network || entry.payerAccountId !== entry.hederaAccount) continue;
    const existing = latest.get(entry.hederaAccount);
    if (!existing || compareTimestamps(entry.consensusTimestamp, existing.consensusTimestamp) > 0) {
      latest.set(entry.hederaAccount, entry);
    }
  }
  return [...latest.values()];
}
