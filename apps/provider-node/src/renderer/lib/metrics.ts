/**
 * Everything the dashboard reports is derived here, from the audit records the agent published on
 * HCS — nothing is estimated or filled in. If a number can't be computed from an audit entry, no
 * screen shows it.
 */
import { HBAR_ASSET } from "@decomp/hedera-x402";
import type { AuditEntry, RegistryEntry } from "@decomp/hcs-registry";
import { consensusDate } from "./format";

export type AssetTotal = { asset: string; total: bigint; jobs: number };

export type ProviderSummary = {
  jobs: number;
  succeeded: number;
  failed: number;
  /** Wall-clock GPU seconds actually sold, summed across every job. */
  gpuSeconds: number;
  byAsset: AssetTotal[];
  hbarTotal: bigint;
  uniqueAgents: number;
  jobTypes: number;
  lastJobAt: Date | null;
  firstJobAt: Date | null;
  /** Mean paid seconds per job; null with no jobs. */
  avgJobSeconds: number | null;
  /** Tinybars earned per hour of GPU time actually sold; null when no HBAR-paid time exists. */
  hbarPerGpuHour: bigint | null;
  settlements: number;
};

export const EMPTY_SUMMARY: ProviderSummary = {
  jobs: 0,
  succeeded: 0,
  failed: 0,
  gpuSeconds: 0,
  byAsset: [],
  hbarTotal: 0n,
  uniqueAgents: 0,
  jobTypes: 0,
  lastJobAt: null,
  firstJobAt: null,
  avgJobSeconds: null,
  hbarPerGpuHour: null,
  settlements: 0,
};

export function summarize(entries: AuditEntry[]): ProviderSummary {
  if (entries.length === 0) return EMPTY_SUMMARY;

  const byAsset = new Map<string, { total: bigint; jobs: number }>();
  const agents = new Set<string>();
  const jobTypes = new Set<string>();
  let gpuSeconds = 0;
  let hbarSeconds = 0;
  let succeeded = 0;
  let settlements = 0;
  let earliest = Infinity;
  let latest = -Infinity;

  for (const entry of entries) {
    const row = byAsset.get(entry.asset) ?? { total: 0n, jobs: 0 };
    byAsset.set(entry.asset, { total: row.total + BigInt(entry.totalPaid), jobs: row.jobs + 1 });
    agents.add(entry.agent);
    jobTypes.add(entry.jobType);
    gpuSeconds += entry.wallClockS;
    if (entry.asset === HBAR_ASSET) hbarSeconds += entry.wallClockS;
    if (isSuccess(entry)) succeeded += 1;
    settlements += entry.transactions.length;
    const at = consensusDate(entry.consensusTimestamp).getTime();
    earliest = Math.min(earliest, at);
    latest = Math.max(latest, at);
  }

  const hbarTotal = byAsset.get(HBAR_ASSET)?.total ?? 0n;
  return {
    jobs: entries.length,
    succeeded,
    failed: entries.length - succeeded,
    gpuSeconds,
    byAsset: [...byAsset.entries()]
      .map(([asset, row]) => ({ asset, ...row }))
      .sort((a, b) => (a.asset === HBAR_ASSET ? -1 : b.asset === HBAR_ASSET ? 1 : 0)),
    hbarTotal,
    uniqueAgents: agents.size,
    jobTypes: jobTypes.size,
    lastJobAt: new Date(latest),
    firstJobAt: new Date(earliest),
    avgJobSeconds: gpuSeconds / entries.length,
    // Only HBAR-paid seconds go in the denominator: mixing in DCC-paid time would understate the rate.
    hbarPerGpuHour: hbarSeconds > 0 ? (hbarTotal * 3600n) / BigInt(Math.round(hbarSeconds)) : null,
    settlements,
  };
}

/** A job counts as served when the agent recorded it completed; anything else is a miss. */
export function isSuccess(entry: AuditEntry): boolean {
  return entry.status === "completed" || entry.status === "succeeded" || entry.status === "ok";
}

export type DayBucket = { day: Date; key: string; total: bigint; jobs: number };

/**
 * One bucket per local day over the trailing `days`, including the days with nothing in them —
 * a bar chart with gaps closed up would misstate the cadence.
 */
export function dailyTotals(entries: AuditEntry[], asset: string, days: number, now = new Date()): DayBucket[] {
  const buckets: DayBucket[] = [];
  const index = new Map<string, DayBucket>();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);

  for (let offset = days - 1; offset >= 0; offset--) {
    const day = new Date(start);
    day.setDate(day.getDate() - offset);
    const bucket = { day, key: dayKey(day), total: 0n, jobs: 0 };
    buckets.push(bucket);
    index.set(bucket.key, bucket);
  }

  for (const entry of entries) {
    if (entry.asset !== asset) continue;
    const bucket = index.get(dayKey(consensusDate(entry.consensusTimestamp)));
    if (!bucket) continue;
    bucket.total += BigInt(entry.totalPaid);
    bucket.jobs += 1;
  }
  return buckets;
}

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

/** Total earned in an asset over the trailing `days`, and the equal window before it, to compare. */
export function windowTotals(entries: AuditEntry[], asset: string, days: number, now = new Date()): { current: bigint; previous: bigint } {
  const span = days * 86_400_000;
  const cutoff = now.getTime() - span;
  let current = 0n;
  let previous = 0n;
  for (const entry of entries) {
    if (entry.asset !== asset) continue;
    const at = consensusDate(entry.consensusTimestamp).getTime();
    if (at >= cutoff) current += BigInt(entry.totalPaid);
    else if (at >= cutoff - span) previous += BigInt(entry.totalPaid);
  }
  return { current, previous };
}

export function countInWindow(entries: AuditEntry[], days: number, now = new Date()): number {
  const cutoff = now.getTime() - days * 86_400_000;
  return entries.filter(e => consensusDate(e.consensusTimestamp).getTime() >= cutoff).length;
}

export type JobTypeStat = { jobType: string; jobs: number; seconds: number; hbar: bigint };

export function byJobType(entries: AuditEntry[]): JobTypeStat[] {
  const map = new Map<string, JobTypeStat>();
  for (const entry of entries) {
    const row = map.get(entry.jobType) ?? { jobType: entry.jobType, jobs: 0, seconds: 0, hbar: 0n };
    row.jobs += 1;
    row.seconds += entry.wallClockS;
    if (entry.asset === HBAR_ASSET) row.hbar += BigInt(entry.totalPaid);
    map.set(entry.jobType, row);
  }
  return [...map.values()].sort((a, b) => b.jobs - a.jobs);
}

export type MarketPosition = {
  /** This node's own current listing, or null when it has never registered (or was outbid off the topic). */
  listing: RegistryEntry | null;
  /** Everyone else currently listed on this network. */
  competitors: number;
  /** Per job type this node offers: its price rank against everyone offering the same type. */
  ranks: { jobType: string; pricePerSecTinybars: string; rank: number; of: number; cheapest: string }[];
};

export function marketPosition(registry: RegistryEntry[], accountId: string | null): MarketPosition {
  const listing = accountId ? (registry.find(entry => entry.hederaAccount === accountId) ?? null) : null;
  const ranks: MarketPosition["ranks"] = [];

  for (const offer of listing?.jobTypes ?? []) {
    const prices = registry
      .flatMap(entry => entry.jobTypes.filter(o => o.name === offer.name).map(o => BigInt(o.pricePerSecTinybars)))
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const mine = BigInt(offer.pricePerSecTinybars);
    ranks.push({
      jobType: offer.name,
      pricePerSecTinybars: offer.pricePerSecTinybars,
      // Ties share the better rank, the way a leaderboard reads.
      rank: prices.findIndex(price => price >= mine) + 1,
      of: prices.length,
      cheapest: (prices[0] ?? mine).toString(),
    });
  }

  return { listing, competitors: registry.filter(entry => entry.hederaAccount !== accountId).length, ranks };
}
