/**
 * GPU compute provider. `POST /jobs` is x402-gated at a flat price per job type; the job starts
 * once payment verifies, and is cancelled if settlement then fails. Results are only released
 * for jobs whose payment settled.
 */
import { x402HTTPResourceServer, type RoutesConfig } from "@x402/core/server";
import {
  HBAR_ASSET,
  accountFromEnv,
  createPaymentGate,
  createResourceServer,
  fetchFacilitatorFeePayer,
  formatTinybars,
  hashscanTxUrl,
  networkConfig,
  requireEnv,
  sdkClient,
} from "@decomp/hedera-x402";
import { REGISTRATION_SCHEMA, publishRegistration } from "@decomp/hcs-registry";
import { parseJobRequest, parseOffers, type JobRequest } from "./offers";
import { RunnerClient, RunnerError, type RunnerJob } from "./runner-client";

const { network, facilitatorUrl } = networkConfig();
const providerName = process.env.PROVIDER_NAME ?? "PROVIDER_1";
const payTo = requireEnv(`${providerName}_ACCOUNT_ID`);
const port = Number(process.env.PORT ?? 4021);
const maxRuntimeS = Number(process.env.MAX_RUNTIME_S ?? 120);
const offers = parseOffers(process.env.PROVIDER_OFFERS ?? "benchmark:10000000");
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

type Payment = { transaction: string; payer: string; amount: string; asset: string; settledAt: string };
type ProviderJob = JobRequest & {
  id: string;
  createdAt: string;
  state: "awaiting_settlement" | "paid" | "settlement_failed";
  payments: Payment[];
};
const jobs = new Map<string, ProviderJob>();

const routes: RoutesConfig = {
  "POST /jobs": {
    accepts: {
      scheme: "exact",
      network,
      payTo,
      // Body was validated before the gate runs, so the offer always exists here.
      price: context => {
        const { jobType } = context.adapter.getBody?.() as JobRequest;
        return { asset: HBAR_ASSET, amount: offers.get(jobType)!.priceTinybars.toString() };
      },
      maxTimeoutSeconds: 120,
    },
    description: `GPU job on ${providerName}`,
    mimeType: "application/json",
  },
};
const gate = createPaymentGate(new x402HTTPResourceServer(createResourceServer(network), routes));

function offerList() {
  return [...offers.values()].map(o => ({
    jobType: o.jobType,
    priceTinybars: o.priceTinybars.toString(),
    price: formatTinybars(o.priceTinybars),
  }));
}

async function createJob(req: Request): Promise<Response> {
  const parsed = parseJobRequest(await req.json().catch(() => undefined), offers);
  if ("error" in parsed) {
    return Response.json({ error: parsed.error, offers: offerList() }, { status: 400 });
  }

  let job: ProviderJob | undefined;
  const outcome = await gate(req, parsed, async payment => {
    if (!payment) {
      return Response.json({ error: "payment required" }, { status: 402 });
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
    job = { ...parsed, id, createdAt: new Date().toISOString(), state: "awaiting_settlement", payments: [] };
    jobs.set(id, job);
    console.log(`[provider] payment verified for ${payment.requirements.amount} tinybars → started job ${id}`);
    return Response.json({ jobId: id, status: "running", statusUrl: `/jobs/${id}` }, { status: 202 });
  });

  switch (outcome.kind) {
    case "rejected":
      console.log(`[provider] ${outcome.response.status} for POST /jobs (${parsed.jobType})`);
      break;
    case "handler_failed":
      console.log(`[provider] job not started (${outcome.response.status}); payment not settled`);
      break;
    case "settled": {
      const { settlement } = outcome;
      job!.state = "paid";
      job!.payments.push({
        transaction: settlement.transaction,
        payer: settlement.payer ?? "",
        amount: offers.get(job!.jobType)!.priceTinybars.toString(),
        asset: HBAR_ASSET,
        settledAt: new Date().toISOString(),
      });
      console.log(`[provider] settled job ${job!.id}: ${hashscanTxUrl(settlement.transaction, network)}`);
      break;
    }
    case "settle_failed":
      console.error(`[provider] settlement failed (${outcome.errorReason}); cancelling job ${job?.id}`);
      if (job) {
        job.state = "settlement_failed";
        await runner.cancel(job.id).catch(error => console.error("[provider] cancel failed:", error));
      }
      break;
  }
  return outcome.response;
}

async function getJob(id: string): Promise<Response> {
  const job = jobs.get(id);
  if (!job) {
    return Response.json({ error: "job not found" }, { status: 404 });
  }
  let run: RunnerJob | undefined;
  try {
    run = await runner.get(id);
  } catch (error) {
    console.error(`[provider] could not read job ${id} from runner:`, error);
  }
  const paid = job.state === "paid";
  return Response.json({
    jobId: job.id,
    jobType: job.jobType,
    provider: { name: providerName, account: payTo },
    state: job.state,
    status: job.state === "settlement_failed" ? "cancelled" : (run?.status ?? "unknown"),
    wallClockS: run?.wall_clock_s,
    startedAt: run?.started_at,
    finishedAt: run?.finished_at,
    // Results are withheld until the payment has actually settled on-chain.
    result: paid ? run?.result : undefined,
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
          offers: offerList(),
          registry: { topicId: registryTopicId, ...registration },
        }),
    },
    "/jobs": { POST: createJob },
    "/jobs/:id": { GET: req => getJob(req.params.id) },
  },
  fetch: () => Response.json({ error: "not found" }, { status: 404 }),
});

console.log(`[provider] ${providerName} (${payTo}) listening on ${server.url}`);
console.log(`[provider] offers: ${offerList().map(o => `${o.jobType}=${o.price}`).join(", ")}`);
fetchFacilitatorFeePayer(network).then(
  feePayer => console.log(`[provider] facilitator ${facilitatorUrl} fee payer ${feePayer}`),
  error => console.error("[provider] facilitator unreachable:", error),
);
runner.health().then(
  ({ job_types }) => console.log(`[provider] job runner ok: ${Object.keys(job_types).join(", ")}`),
  () => console.error(`[provider] job runner not reachable — start it with \`bun run dev:runner\``),
);

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
    jobTypes: [...offers.values()].map(o => ({ name: o.jobType, priceTinybars: o.priceTinybars.toString() })),
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
