/** Metered offers: each job type has a price per GPU-second and is paid in fixed-length ticks. */
export type Offer = { jobType: string; pricePerSecTinybars: bigint; tickSeconds: number };
export type JobRequest = { jobType: string; params: Record<string, unknown> };

export function tickPrice(offer: Offer): bigint {
  return offer.pricePerSecTinybars * BigInt(offer.tickSeconds);
}

/** Parses `PROVIDER_OFFERS`, e.g. `benchmark:2000000,mandelbrot:3000000` (tinybars per GPU-second). */
export function parseOffers(spec: string, tickSeconds: number): Map<string, Offer> {
  if (!Number.isInteger(tickSeconds) || tickSeconds < 1) {
    throw new Error(`TICK_SECONDS must be a positive integer, got ${tickSeconds}`);
  }
  const offers = new Map<string, Offer>();
  for (const entry of spec.split(",").map(s => s.trim()).filter(Boolean)) {
    const [jobType, price] = entry.split(":");
    if (!jobType || !price || !/^\d+$/.test(price) || BigInt(price) <= 0n) {
      throw new Error(`Invalid offer "${entry}" — expected <jobType>:<tinybars per second>`);
    }
    offers.set(jobType, { jobType, pricePerSecTinybars: BigInt(price), tickSeconds });
  }
  if (offers.size === 0) {
    throw new Error("PROVIDER_OFFERS must list at least one job type");
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
