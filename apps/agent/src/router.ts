/** Chooses which provider gets a job, and falls back when a provider can't be reached. */

export type Candidate = {
  providerId: string;
  hederaAccount: string;
  endpoint: string;
  priceTinybars: bigint;
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
    super(`provider ${endpoint} unavailable: ${reason instanceof Error ? reason.message : String(reason)}`);
    this.name = "ProviderUnavailableError";
  }
}

/** Cheapest first; ties go to the most recent registration, then account id for a stable order. */
export function rankCandidates(candidates: Candidate[], { maxPriceTinybars }: { maxPriceTinybars?: bigint } = {}): Candidate[] {
  return candidates
    .filter(c => maxPriceTinybars === undefined || c.priceTinybars <= maxPriceTinybars)
    .sort(
      (a, b) =>
        (a.priceTinybars < b.priceTinybars ? -1 : a.priceTinybars > b.priceTinybars ? 1 : 0) ||
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
  const tried = skipped.map(s => s.candidate.providerId).join(", ") || "none";
  throw new Error(`no eligible provider could take the job (tried: ${tried})`);
}
