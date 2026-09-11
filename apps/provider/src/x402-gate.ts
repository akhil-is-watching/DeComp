/**
 * x402 routes for metered jobs. Creating a job pays for its first tick in any asset the provider
 * prices in; each later tick is bought through POST /jobs/:id/ticks, which answers with a fresh 402
 * "continue" challenge in the job's locked-in asset and price.
 */
import type { PaymentOption } from "@x402/core/http";
import { x402HTTPResourceServer, type HTTPRequestContext, type RoutesConfig } from "@x402/core/server";
import { createPaymentGate, createResourceServer, type HederaNetwork } from "@decomp/hedera-x402";
import type { JobQueue } from "./job-queue";
import { priceIn, tickAmount, type JobRequest, type Offer } from "./pricing";

const TICK_PATH = /^\/jobs\/([^/]+)\/ticks$/;

export function createJobGate(config: {
  network: HederaNetwork;
  payTo: string;
  providerName: string;
  offers: Map<string, Offer>;
  queue: JobQueue;
  tickSeconds: number;
}) {
  const { network, payTo, providerName, offers, queue, tickSeconds } = config;
  // parseOffers guarantees every job type is priced in the same assets, so the options are fixed.
  const assets = [...offers.values()][0]!.prices.map(p => p.asset);

  const firstTick = (asset: string): PaymentOption => ({
    scheme: "exact",
    network,
    payTo,
    // The body is validated before the gate runs, so the offer always exists here.
    price: (context: HTTPRequestContext) => {
      const offer = offers.get((context.adapter.getBody?.() as JobRequest).jobType)!;
      return { asset, amount: tickAmount(priceIn(offer, asset)!, offer.tickSeconds).toString() };
    },
    maxTimeoutSeconds: 120,
  });

  const routes: RoutesConfig = {
    "POST /jobs": {
      accepts: assets.map(firstTick),
      description: `First ${tickSeconds}s of a GPU job on ${providerName}`,
      mimeType: "application/json",
    },
    "POST /jobs/:id/ticks": {
      accepts: {
        scheme: "exact",
        network,
        payTo,
        price: (context: HTTPRequestContext) => {
          const id = TICK_PATH.exec(context.path)?.[1];
          const job = id ? queue.get(decodeURIComponent(id)) : undefined;
          if (!job) throw new Error(`unknown job ${id}`);
          return { asset: job.price.asset, amount: tickAmount(job.price, job.tickSeconds).toString() };
        },
        maxTimeoutSeconds: 120,
      },
      description: `Next ${tickSeconds}s of a running GPU job on ${providerName}`,
      mimeType: "application/json",
    },
  };
  return createPaymentGate(new x402HTTPResourceServer(createResourceServer(network), routes));
}
