/**
 * GPU compute provider with metered billing. Creating a job (POST /jobs) pays for its first tick
 * of GPU time, in HBAR or the compute token; each further tick is paid through
 * POST /jobs/:id/ticks. The job queue kills any job that runs past its paid time plus a grace
 * period, so payment is enforced here rather than trusted to the agent. Results are only
 * released for jobs whose payments settled.
 */
import type { SettleResponse } from "@x402/core/types";
import { REGISTRATION_SCHEMA, publishRegistration } from "@decomp/hcs-registry";
import {
  accountFromEnv,
  fetchFacilitatorFeePayer,
  hashscanTxUrl,
  isTokenAssociated,
  networkConfig,
  requireEnv,
  sdkClient,
} from "@decomp/hedera-x402";
import { JobQueue, paidSeconds, type MeteredJob } from "./job-queue";
import { describePrice, hbarPrice, parseJobRequest, parseOffers, priceIn, tickAmount } from "./pricing";
import { RunnerClient, RunnerError, type RunnerJob } from "./runner-client";
import { createJobGate } from "./x402-gate";

const { network, facilitatorUrl } = networkConfig();
const providerName = process.env.PROVIDER_NAME ?? "PROVIDER_1";
const payTo = requireEnv(`${providerName}_ACCOUNT_ID`);
const port = Number(process.env.PORT ?? 4021);
const maxRuntimeS = Number(process.env.MAX_RUNTIME_S ?? 600);
const tickSeconds = Number(process.env.TICK_SECONDS ?? 5);
const graceSeconds = Number(process.env.TICK_GRACE_SECONDS ?? 5);
const computeTokenId = process.env.COMPUTE_TOKEN_ID || undefined;
const tokenSpec = process.env.PROVIDER_TOKEN_OFFERS || undefined;
const offers = parseOffers(
  process.env.PROVIDER_OFFERS ?? "benchmark:2000000",
  tickSeconds,
  computeTokenId && tokenSpec ? { tokenId: computeTokenId, spec: tokenSpec } : undefined,
);
const runner = new RunnerClient(process.env.JOB_RUNNER_URL ?? "http://127.0.0.1:8100");
const publicUrl = process.env.PUBLIC_URL ?? `http://127.0.0.1:${port}`;
const registryTopicId = process.env.REGISTRY_TOPIC_ID || undefined;

type RegistrationState = {
  status: "disabled" | "pending" | "published" | "failed";
  sequenceNumber?: number;
  transactionId?: string;
  error?: string;
};
let registration: RegistrationState = { status: registryTopicId ? "pending" : "disabled" };

const queue = new JobQueue(runner, { graceSeconds, log: line => console.log(`[meter] ${line}`) });
queue.start();
const gate = createJobGate({ network, payTo, providerName, offers, queue, tickSeconds });

function offerList() {
  return [...offers.values()].map(o => ({
    jobType: o.jobType,
    tickSeconds: o.tickSeconds,
    prices: o.prices.map(p => ({
      asset: p.asset,
      perSecond: p.perSecond.toString(),
      tickAmount: tickAmount(p, o.tickSeconds).toString(),
      label: describePrice(p),
    })),
  }));
}

function recordSettlement(job: MeteredJob, settlement: SettleResponse) {
  const payment = queue.recordPayment(job.id, settlement);
  console.log(
    `[provider] tick ${payment.tick} settled for job ${job.id} (${paidSeconds(job)}s paid): ` +
      hashscanTxUrl(settlement.transaction, network),
  );
}

async function createJob(req: Request): Promise<Response> {
  const parsed = parseJobRequest(await req.json().catch(() => undefined), offers);
  if ("error" in parsed) {
    return Response.json({ error: parsed.error, offers: offerList() }, { status: 400 });
  }

  let job: MeteredJob | undefined;
  const outcome = await gate(req, parsed, async payment => {
    if (!payment) {
      return Response.json({ error: "payment required" }, { status: 402 });
    }
    const offer = offers.get(parsed.jobType)!;
    const price = priceIn(offer, payment.requirements.asset);
    if (!price) {
      return Response.json({ error: `${parsed.jobType} is not priced in ${payment.requirements.asset}` }, { status: 400 });
    }
    const id = crypto.randomUUID();
    try {
      await runner.submit({ jobId: id, jobType: parsed.jobType, params: parsed.params, maxRuntimeS });
    } catch (error) {
      if (error instanceof RunnerError && error.status === 422) {
        return Response.json({ error: error.detail }, { status: 422 });
      }
      console.error("[provider] job runner unavailable:", error);
      return Response.json({ error: "job runner unavailable" }, { status: 503 });
    }
    job = queue.create({ id, jobType: parsed.jobType, params: parsed.params, tickSeconds: offer.tickSeconds, price });
    console.log(`[provider] first tick verified (${payment.requirements.amount} of ${price.asset}) → started job ${id}`);
    return Response.json(
      { jobId: id, status: "running", statusUrl: `/jobs/${id}`, ticksUrl: `/jobs/${id}/ticks`, tickSeconds: job.tickSeconds, asset: price.asset },
      { status: 202 },
    );
  });

  switch (outcome.kind) {
    case "rejected":
      console.log(`[provider] ${outcome.response.status} for POST /jobs (${parsed.jobType})`);
      break;
    case "handler_failed":
      console.log(`[provider] job not started (${outcome.response.status}); payment not settled`);
      break;
    case "settled":
      recordSettlement(job!, outcome.settlement);
      break;
    case "settle_failed":
      console.error(`[provider] settlement failed (${outcome.errorReason}); cancelling job ${job?.id}`);
      if (job) await queue.markSettlementFailed(job.id);
      break;
  }
  return outcome.response;
}

async function payTick(req: Request, id: string): Promise<Response> {
  const job = queue.get(id);
  if (!job) {
    return Response.json({ error: "job not found" }, { status: 404 });
  }
  // Refuse before issuing a challenge, so nobody pays for a tick that can't be used.
  const refusal = queue.tickRefusal(job);
  if (refusal) {
    return Response.json({ error: refusal }, { status: 409 });
  }

  let settling = false;
  try {
    const outcome = await gate(req, undefined, async payment => {
      if (!payment) {
        return Response.json({ error: "payment required" }, { status: 402 });
      }
      const late = queue.tickRefusal(job);
      if (late) {
        return Response.json({ error: late }, { status: 409 });
      }
      // Hold billing and enforcement until this verified tick settles.
      queue.beginTickSettlement(id);
      settling = true;
      return Response.json({ jobId: id, tick: job.payments.length + 1, tickSeconds: job.tickSeconds });
    });

    if (outcome.kind === "settled") {
      recordSettlement(job, outcome.settlement);
    } else if (outcome.kind === "settle_failed") {
      console.error(`[provider] tick settlement failed for job ${id} (${outcome.errorReason})`);
    }
    return outcome.response;
  } finally {
    if (settling) queue.endTickSettlement(id);
  }
}

async function getJob(id: string): Promise<Response> {
  const job = queue.get(id);
  if (!job) {
    return Response.json({ error: "job not found" }, { status: 404 });
  }
  let run: RunnerJob | undefined = job.lastRun;
  try {
    run = await runner.get(id);
  } catch (error) {
    console.error(`[provider] could not read job ${id} from runner:`, error);
  }
  const released = (job.state === "paid" || job.state === "finished") && run?.status === "succeeded";
  return Response.json({
    jobId: job.id,
    jobType: job.jobType,
    provider: { name: providerName, account: payTo },
    state: job.state,
    status: job.state === "settlement_failed" ? "cancelled" : (run?.status ?? "unknown"),
    wallClockS: run?.wall_clock_s,
    startedAt: run?.started_at,
    finishedAt: run?.finished_at,
    asset: job.price.asset,
    pricePerSecond: job.price.perSecond.toString(),
    tickSeconds: job.tickSeconds,
    tickAmount: tickAmount(job.price, job.tickSeconds).toString(),
    paidTicks: job.payments.length,
    paidSeconds: paidSeconds(job),
    graceSeconds,
    reconciliation: job.reconciliation,
    // Results are withheld until payment has settled on-chain.
    result: released ? run?.result : undefined,
    error: run?.error ?? undefined,
    payments: job.payments.map(p => ({ ...p, hashscan: hashscanTxUrl(p.transaction, network) })),
  });
}

const server = Bun.serve({
  port,
  routes: {
    "/health": {
      GET: async () => {
        const runnerOk = await runner.health().then(() => true, () => false);
        return Response.json({ status: runnerOk ? "ok" : "degraded", runner: runnerOk }, { status: runnerOk ? 200 : 503 });
      },
    },
    "/info": {
      GET: () =>
        Response.json({
          name: providerName,
          account: payTo,
          endpoint: publicUrl,
          network,
          facilitator: facilitatorUrl,
          metering: { tickSeconds, graceSeconds },
          offers: offerList(),
          registry: { topicId: registryTopicId, ...registration },
        }),
    },
    "/jobs": { POST: createJob },
    "/jobs/:id": { GET: req => getJob(req.params.id) },
    "/jobs/:id/ticks": { POST: req => payTick(req, req.params.id) },
  },
  fetch: () => Response.json({ error: "not found" }, { status: 404 }),
});

console.log(`[provider] ${providerName} (${payTo}) listening on ${server.url}`);
for (const offer of offerList()) {
  console.log(`[provider] ${offer.jobType}: ${offer.prices.map(p => `${p.label}/s`).join(" or ")} in ${tickSeconds}s ticks`);
}
fetchFacilitatorFeePayer(network).then(
  feePayer => console.log(`[provider] facilitator ${facilitatorUrl} fee payer ${feePayer}`),
  error => console.error("[provider] facilitator unreachable:", error),
);
runner.health().then(
  ({ job_types }) => console.log(`[provider] job runner ok: ${Object.keys(job_types).join(", ")}`),
  () => console.error(`[provider] job runner not reachable — start it with \`bun run dev:runner\``),
);
if (computeTokenId && tokenSpec) {
  // An unassociated payTo fails settlement with a generic error, so say so up front.
  isTokenAssociated(payTo, computeTokenId).then(
    associated =>
      associated
        ? console.log(`[provider] accepting compute token ${computeTokenId}`)
        : console.error(`[provider] ${payTo} is not associated with ${computeTokenId}; run \`bun run setup:token\``),
    error => console.error("[provider] could not check token association:", error),
  );
}

if (registryTopicId) {
  // Published with the provider's own key: readers only trust registrations paid for by the
  // account they advertise.
  const client = sdkClient(accountFromEnv(providerName), network);
  publishRegistration(client, registryTopicId, {
    schema: REGISTRATION_SCHEMA,
    providerId: providerName,
    hederaAccount: payTo,
    endpoint: publicUrl,
    network,
    jobTypes: [...offers.values()].map(o => ({
      name: o.jobType,
      pricePerSecTinybars: hbarPrice(o).perSecond.toString(),
      tickSeconds: o.tickSeconds,
    })),
    publishedAt: new Date().toISOString(),
  })
    .then(
      ({ sequenceNumber, transactionId }) => {
        registration = { status: "published", sequenceNumber, transactionId };
        console.log(`[provider] registered on HCS topic ${registryTopicId} (seq ${sequenceNumber}, tx ${transactionId})`);
      },
      error => {
        registration = { status: "failed", error: error instanceof Error ? error.message : String(error) };
        console.error("[provider] registry publish failed:", error);
      },
    )
    .finally(() => client.close());
}
