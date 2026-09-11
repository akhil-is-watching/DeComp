/** Registry-driven jobs: discover providers on HCS, pick the cheapest, fall back if it's down. */
import { formatTinybars } from "@decomp/hedera-x402";
import { discoverProviders } from "./discovery";
import { rankCandidates, routeWithFallback } from "./router";
import { runJob, type RunJobOptions } from "./run-job";

export type RoutedJobOptions = Omit<RunJobOptions, "providerUrl" | "expectedAccount" | "maxTinybarsPerPayment"> & {
  topicId: string;
  /** Providers charging more per GPU-second are never considered. */
  maxPricePerSecTinybars?: bigint;
};

export async function discoverAndRunJob({ topicId, maxPricePerSecTinybars, ...options }: RoutedJobOptions) {
  const log = options.log ?? console.log;
  const ranked = rankCandidates(await discoverProviders(topicId, options.jobType), { maxPricePerSecTinybars });
  log(
    `route   ${ranked.length} eligible for ${options.jobType}: ` +
      (ranked.map(c => `${c.providerId}=${formatTinybars(c.pricePerSecTinybars)}/s`).join(", ") || "none"),
  );

  const { candidate, value, skipped } = await routeWithFallback(
    ranked,
    // Cap each payment at one tick of the registered price, so a provider can't charge more than it advertised.
    c =>
      runJob({
        ...options,
        providerUrl: c.endpoint,
        expectedAccount: c.hederaAccount,
        maxTinybarsPerPayment: c.pricePerSecTinybars * BigInt(c.tickSeconds),
      }),
    ({ candidate: failed, error }) =>
      log(`fallback ${failed.providerId} unavailable (${error.reason instanceof Error ? error.reason.message : error.reason}); trying next`),
  );
  return { summary: value, chosen: candidate, ranked, skipped };
}
