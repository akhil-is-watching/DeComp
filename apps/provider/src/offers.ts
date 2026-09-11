export type Offer = { jobType: string; priceTinybars: bigint };
export type JobRequest = { jobType: string; params: Record<string, unknown> };

/** Parses `PROVIDER_OFFERS`, e.g. `benchmark:10000000,upscale:25000000` (flat tinybars per job). */
export function parseOffers(spec: string): Map<string, Offer> {
  const offers = new Map<string, Offer>();
  for (const entry of spec.split(",").map(s => s.trim()).filter(Boolean)) {
    const [jobType, price] = entry.split(":");
    if (!jobType || !price || !/^\d+$/.test(price) || BigInt(price) <= 0n) {
      throw new Error(`Invalid offer "${entry}" — expected <jobType>:<tinybars>`);
    }
    offers.set(jobType, { jobType, priceTinybars: BigInt(price) });
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
