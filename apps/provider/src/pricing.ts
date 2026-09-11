/**
 * Metered prices. Every job type has a per-GPU-second price in HBAR and, when a compute token is
 * configured, in that HTS token too. A job is paid in fixed-length ticks in whichever asset the
 * agent chose when creating it.
 */
import { HBAR_ASSET, formatTinybars } from "@decomp/hedera-x402";

/** Price per GPU-second in the asset's smallest unit (tinybars for HBAR). */
export type AssetPrice = { asset: string; perSecond: bigint };
export type Offer = { jobType: string; tickSeconds: number; prices: AssetPrice[] };
export type JobRequest = { jobType: string; params: Record<string, unknown> };

export function tickAmount(price: AssetPrice, tickSeconds: number): bigint {
  return price.perSecond * BigInt(tickSeconds);
}

export function priceIn(offer: Offer, asset: string): AssetPrice | undefined {
  return offer.prices.find(p => p.asset === asset);
}

export function hbarPrice(offer: Offer): AssetPrice {
  return priceIn(offer, HBAR_ASSET)!;
}

export function describePrice(price: AssetPrice): string {
  return price.asset === HBAR_ASSET ? formatTinybars(price.perSecond) : `${price.perSecond} units of ${price.asset}`;
}

function parsePerSecond(spec: string, label: string): Map<string, bigint> {
  const prices = new Map<string, bigint>();
  for (const entry of spec.split(",").map(s => s.trim()).filter(Boolean)) {
    const [jobType, amount] = entry.split(":");
    if (!jobType || !amount || !/^\d+$/.test(amount) || BigInt(amount) <= 0n) {
      throw new Error(`Invalid ${label} entry "${entry}" — expected <jobType>:<amount per second>`);
    }
    prices.set(jobType, BigInt(amount));
  }
  return prices;
}

/**
 * `hbarSpec` is PROVIDER_OFFERS in tinybars per second, e.g. `benchmark:2000000,mandelbrot:3000000`.
 * `token`, when given, prices every job type in that HTS token as well (PROVIDER_TOKEN_OFFERS, in
 * the token's smallest unit per second). x402 route options are fixed at startup, so token pricing
 * must cover exactly the job types priced in HBAR.
 */
export function parseOffers(hbarSpec: string, tickSeconds: number, token?: { tokenId: string; spec: string }): Map<string, Offer> {
  if (!Number.isInteger(tickSeconds) || tickSeconds < 1) {
    throw new Error(`TICK_SECONDS must be a positive integer, got ${tickSeconds}`);
  }
  const hbar = parsePerSecond(hbarSpec, "PROVIDER_OFFERS");
  if (hbar.size === 0) {
    throw new Error("PROVIDER_OFFERS must list at least one job type");
  }
  const tokenPrices = token ? parsePerSecond(token.spec, "PROVIDER_TOKEN_OFFERS") : new Map<string, bigint>();
  for (const jobType of tokenPrices.keys()) {
    if (!hbar.has(jobType)) throw new Error(`PROVIDER_TOKEN_OFFERS prices ${jobType}, which PROVIDER_OFFERS doesn't offer`);
  }

  const offers = new Map<string, Offer>();
  for (const [jobType, perSecond] of hbar) {
    const prices: AssetPrice[] = [{ asset: HBAR_ASSET, perSecond }];
    if (token) {
      const tokenPerSecond = tokenPrices.get(jobType);
      if (tokenPerSecond === undefined) throw new Error(`PROVIDER_TOKEN_OFFERS has no price for ${jobType}`);
      prices.push({ asset: token.tokenId, perSecond: tokenPerSecond });
    }
    offers.set(jobType, { jobType, tickSeconds, prices });
  }
  return offers;
}

export function parseJobRequest(body: unknown, offers: Map<string, Offer>): JobRequest | { error: string } {
  if (!body || typeof body !== "object") {
    return { error: "body must be a JSON object like {\"jobType\": \"benchmark\", \"params\": {}}" };
  }
  const { jobType, params = {} } = body as { jobType?: unknown; params?: unknown };
  if (typeof jobType !== "string" || !offers.has(jobType)) {
    return { error: `jobType must be one of: ${[...offers.keys()].join(", ")}` };
  }
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    return { error: "params must be an object" };
  }
  return { jobType, params: params as Record<string, unknown> };
}
