/** Chooses which provider gets a job, and falls back when a provider can't be reached. */

export type Candidate = {
  providerId: string;
  hederaAccount: string;
  endpoint: string;
  pricePerSecTinybars: bigint;
  tickSeconds: number;
  registeredAt: string;
};

/**
 * Thrown when a provider can't be reached before any payment was signed. Only this error
 * triggers fallback: retrying after a signature could pay two providers for one job.
 */
export class ProviderUnavailableError extends Error {
  constructor(
    readonly endpoint: string,
    readonly reason: unknown,
  ) {
    super(`provider ${endpoint} unavailable: ${reasonText(reason)}`);
    this.name = "ProviderUnavailableError";
  }
}

export const reasonText = (reason: unknown) => (reason instanceof Error ? reason.message : String(reason));

const compareBigints = (a: bigint, b: bigint) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Cheapest per GPU-second first. Ties go to the smaller tick (less paid up front), then the most
 * recent registration, then account id for a stable order.
 */
export function rankCandidates(
  candidates: Candidate[],
  { maxPricePerSecTinybars }: { maxPricePerSecTinybars?: bigint } = {},
): Candidate[] {
  return candidates
    .filter(c => maxPricePerSecTinybars === undefined || c.pricePerSecTinybars <= maxPricePerSecTinybars)
    .sort(
      (a, b) =>
        compareBigints(a.pricePerSecTinybars, b.pricePerSecTinybars) ||
        a.tickSeconds - b.tickSeconds ||
        b.registeredAt.localeCompare(a.registeredAt, undefined, { numeric: true }) ||
        a.hederaAccount.localeCompare(b.hederaAccount, undefined, { numeric: true }),
    );
}

export type RouteAttempt = { candidate: Candidate; error: ProviderUnavailableError };

/** Tries ranked candidates in order, moving on only when a provider is unreachable. */
export async function routeWithFallback<T>(
  ranked: Candidate[],
  attempt: (candidate: Candidate) => Promise<T>,
  onFallback: (failed: RouteAttempt) => void = () => {},
): Promise<{ candidate: Candidate; value: T; skipped: RouteAttempt[] }> {
  const skipped: RouteAttempt[] = [];
  for (const candidate of ranked) {
    try {
      return { candidate, value: await attempt(candidate), skipped };
    } catch (error) {
      if (!(error instanceof ProviderUnavailableError)) throw error;
      const failed = { candidate, error };
      skipped.push(failed);
      onFallback(failed);
    }
  }
  if (skipped.length === 0) throw new Error("no eligible provider is online to take the job");
  // Each reason matters more than the names: "one tick costs more than the listed price" and
  // "not connected to the bridge" call for very different responses from whoever reads this.
  const tried = skipped.map(s => `${s.candidate.providerId} (${reasonText(s.error.reason)})`).join("; ");
  throw new Error(`no eligible provider could take the job — tried: ${tried}`);
}
