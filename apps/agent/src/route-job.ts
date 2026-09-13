/** Registry-driven jobs: discover providers on HCS, pick the cheapest, fall back if it's down. */
import { formatTinybars } from "@decomp/hedera-x402";
import { discoverLiveProviders } from "./discovery";
import { rankCandidates, reasonText, routeWithFallback } from "./router";
import { runJob, type RunJobOptions } from "./run-job";

/** The registry lists HBAR prices, so routed jobs always pay in HBAR. */
export type RoutedJobOptions = Omit<RunJobOptions, "providerUrl" | "expectedAccount" | "maxAmountPerPayment" | "asset"> & {
  topicId: string;
  /** Providers charging more per GPU-second are never considered. */
  maxPricePerSecTinybars?: bigint;
};

export async function discoverAndRunJob({ topicId, maxPricePerSecTinybars, ...options }: RoutedJobOptions) {
  const log = options.log ?? console.log;
  // Registrations never expire on HCS, so only route to providers whose runner answers right now —
  // otherwise every job walks through a list of long-gone nodes before reaching a live one.
  const ranked = rankCandidates(await discoverLiveProviders(topicId, options.jobType), { maxPricePerSecTinybars });
  log(
    `route   ${ranked.length} live and eligible for ${options.jobType}: ` +
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
        maxAmountPerPayment: c.pricePerSecTinybars * BigInt(c.tickSeconds),
      }),
    ({ candidate: failed, error }) =>
      log(`fallback ${failed.providerId} unavailable (${reasonText(error.reason)}); trying next`),
  );
  return { summary: value, chosen: candidate, ranked, skipped };
}
