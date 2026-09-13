import { TINYBARS_PER_HBAR } from "@decomp/hedera-x402";

/** HBAR with a fixed number of decimals — for columns of figures that have to line up. */
export function hbar(tinybars: bigint | string, decimals = 4): string {
  const value = BigInt(tinybars);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / TINYBARS_PER_HBAR;
  const frac = (abs % TINYBARS_PER_HBAR).toString().padStart(8, "0").slice(0, decimals);
  const body = decimals > 0 ? `${group(whole)}.${frac}` : group(whole);
  return negative ? `-${body}` : body;
}

/** The same value as a float, for charts and averages. Loses precision by design — never for display of a balance. */
export function hbarFloat(tinybars: bigint | string): number {
  return Number(BigInt(tinybars)) / Number(TINYBARS_PER_HBAR);
}

export function group(value: bigint | number): string {
  return value.toLocaleString("en-US");
}

/** 1,284 / 12.9K / 4.2M — for stat-tile values, where a long number would wrap. */
export function compact(value: number, decimals = 1): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${trimZeroes((value / 1_000_000).toFixed(decimals))}M`;
  if (abs >= 10_000) return `${trimZeroes((value / 1_000).toFixed(decimals))}K`;
  if (abs >= 100) return Math.round(value).toLocaleString("en-US");
  return trimZeroes(value.toFixed(decimals));
}

function trimZeroes(value: string): string {
  return value.includes(".") ? value.replace(/\.?0+$/, "") : value;
}

/** 48s / 12m 09s / 3h 21m — GPU time reads as a duration, never as a raw second count. */
export function duration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return `${total}s`;
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m < 60) return `${m}m ${s.toString().padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h ${(m % 60).toString().padStart(2, "0")}m`;
}

/** An HCS `seconds.nanoseconds` consensus timestamp as a Date. */
export function consensusDate(consensusTimestamp: string): Date {
  const [seconds = "0", nanos = "0"] = consensusTimestamp.split(".");
  return new Date(Number(seconds) * 1000 + Number(nanos.padEnd(9, "0").slice(0, 3)));
}

export function relativeTime(date: Date, now = Date.now()): string {
  const seconds = Math.round((now - date.getTime()) / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function dateTime(date: Date): string {
  return date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function dayLabel(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** 0.0.10490091 -> 0.0.10490091 (kept whole — it's short and people read it); long hex is elided. */
export function shortAddress(address: string, lead = 6, tail = 4): string {
  return address.length <= lead + tail + 1 ? address : `${address.slice(0, lead)}…${address.slice(-tail)}`;
}

export function greeting(now = new Date()): string {
  const hour = now.getHours();
  if (hour < 5) return "Still up";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/** "HBAR", the compute token's ticker when it's the one configured, or the bare token id. */
export function assetName(asset: string, computeTokenId?: string | null): string {
  if (asset === "0.0.0") return "HBAR";
  return asset === computeTokenId ? "DCC" : asset;
}

export function assetUnit(asset: string, computeTokenId?: string | null): string {
  return asset === "0.0.0" ? "ℏ" : assetName(asset, computeTokenId);
}

/** Percent change, or null when there's no baseline to compare against. */
export function percentChange(current: bigint, previous: bigint): number | null {
  if (previous === 0n) return null;
  return (Number(current - previous) / Number(previous)) * 100;
}
