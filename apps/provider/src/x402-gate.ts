/**
 * x402 routes for metered jobs. Creating a job pays for its first tick; each later tick is bought
 * through POST /jobs/:id/ticks, which answers with a fresh 402 "continue" challenge priced at the
 * job's locked-in tick price.
 */
import { x402HTTPResourceServer, type RoutesConfig } from "@x402/core/server";
import { HBAR_ASSET, createPaymentGate, createResourceServer, type HederaNetwork } from "@decomp/hedera-x402";
import type { JobQueue } from "./job-queue";
import { tickPrice, type JobRequest, type Offer } from "./offers";

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
  const routes: RoutesConfig = {
    "POST /jobs": {
      accepts: {
        scheme: "exact",
        network,
        payTo,
        // The body is validated before the gate runs, so the offer always exists here.
        price: context => {
          const { jobType } = context.adapter.getBody?.() as JobRequest;
          return { asset: HBAR_ASSET, amount: tickPrice(offers.get(jobType)!).toString() };
        },
        maxTimeoutSeconds: 120,
      },
      description: `First ${tickSeconds}s of a GPU job on ${providerName}`,
      mimeType: "application/json",
    },
    "POST /jobs/:id/ticks": {
      accepts: {
        scheme: "exact",
        network,
        payTo,
        price: context => {
          const id = TICK_PATH.exec(context.path)?.[1];
          const job = id ? queue.get(decodeURIComponent(id)) : undefined;
          if (!job) throw new Error(`unknown job ${id}`);
          return { asset: HBAR_ASSET, amount: tickPrice(job.offer).toString() };
        },
        maxTimeoutSeconds: 120,
      },
      description: `Next ${tickSeconds}s of a running GPU job on ${providerName}`,
      mimeType: "application/json",
    },
  };
  return createPaymentGate(new x402HTTPResourceServer(createResourceServer(network), routes));
}
