/**
 * Agent job flow: quote → pay the first tick (x402) → keep paying a tick just before each paid
 * window runs out → result. The agent can stop paying at a budget ceiling; the provider then
 * stops the job itself.
 */
import {
  createPayingClient,
  formatTinybars,
  hashscanTxUrl,
  waitForMirrorTransaction,
  type AccountCredentials,
} from "@decomp/hedera-x402";
import { ProviderUnavailableError } from "./router";

export type RunJobOptions = {
  providerUrl: string;
  jobType: string;
  params: Record<string, unknown>;
  account: AccountCredentials;
  /** Largest single payment (one tick) the agent will sign, in tinybars. */
  maxTinybarsPerPayment: bigint;
  /** Most the agent will spend on this job; it stops paying once another tick would exceed this. */
  maxBudgetTinybars?: bigint;
  /** Pay the next tick when this many paid seconds remain; the provider's grace period covers settlement. */
  tickLeadSeconds?: number;
  /** Account the provider must be paid at, e.g. from its registry entry. */
  expectedAccount?: string;
  confirmOnMirror?: boolean;
  pollIntervalMs?: number;
  timeoutMs?: number;
  log?: (line: string) => void;
};

export type JobPayment = {
  transactionId: string;
  amountTinybars: string;
  mirror?: { result: string; consensusTimestamp: string; creditedTinybars: number };
};

export type JobSummary = {
  jobId: string;
  providerUrl: string;
  providerAccount: string;
  jobType: string;
  /** Runner status, e.g. succeeded or killed. */
  status: string;
  /** Provider billing state, e.g. finished or killed_unpaid. */
  state: string;
  payments: JobPayment[];
  totalTinybars: string;
  tickSeconds: number;
  /** Ticks the provider recorded as paid. */
  paidTicks: number;
  budgetExhausted: boolean;
  wallClockS?: number;
  result?: unknown;
  error?: string;
};

type ProviderOffer = { jobType: string; pricePerSecTinybars: string; tickSeconds: number; tickPriceTinybars: string };
type ProviderInfo = { name: string; account: string; offers: ProviderOffer[] };
type ProviderJobView = {
  status: string;
  state: string;
  wallClockS?: number;
  paidTicks: number;
  paidSeconds: number;
  result?: unknown;
  error?: string;
};

const TERMINAL = new Set(["succeeded", "failed", "killed", "timeout", "cancelled"]);

/** JSON with long strings (e.g. base64 images) elided, for log lines. */
function preview(value: unknown): string {
  return JSON.stringify(value, (_, v) => (typeof v === "string" && v.length > 120 ? `<${v.length} chars>` : v));
}

async function fetchInfo(base: string): Promise<ProviderInfo> {
  try {
    const res = await fetch(`${base}/info`, { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) throw new Error(`GET /info returned ${res.status}`);
    return (await res.json()) as ProviderInfo;
  } catch (error) {
    throw new ProviderUnavailableError(base, error);
  }
}

async function fetchJob(base: string, jobId: string): Promise<ProviderJobView> {
  const res = await fetch(`${base}/jobs/${jobId}`, { signal: AbortSignal.timeout(5_000) });
  return (await res.json()) as ProviderJobView;
}

export async function runJob(options: RunJobOptions): Promise<JobSummary> {
  const log = options.log ?? console.log;
  const base = options.providerUrl.replace(/\/$/, "");

  const info = await fetchInfo(base);
  if (options.expectedAccount && info.account !== options.expectedAccount) {
    throw new ProviderUnavailableError(base, new Error(`serves account ${info.account}, expected ${options.expectedAccount}`));
  }
  const offer = info.offers.find(o => o.jobType === options.jobType);
  if (!offer) {
    throw new ProviderUnavailableError(base, new Error(`${info.name} does not offer ${options.jobType}`));
  }
  const tickPrice = BigInt(offer.tickPriceTinybars);
  const budget = options.maxBudgetTinybars;
  if (budget !== undefined && tickPrice > budget) {
    throw new ProviderUnavailableError(base, new Error(`one tick costs ${formatTinybars(tickPrice)}, above the ${formatTinybars(budget)} budget`));
  }
  log(
    `quote   ${info.name} ${info.account} charges ${formatTinybars(offer.pricePerSecTinybars)}/s, ` +
      `billed in ${offer.tickSeconds}s ticks of ${formatTinybars(tickPrice)}`,
  );

  let signed = false;
  const client = createPayingClient({
    account: options.account,
    maxTinybarsPerPayment: options.maxTinybarsPerPayment,
    onEvent: event => {
      switch (event.type) {
        case "payment_required": {
          const req = event.paymentRequired.accepts[0];
          log(`402     pay ${req?.amount} of asset ${req?.asset} to ${req?.payTo} (feePayer ${req?.extra?.feePayer})`);
          break;
        }
        case "payment_signed":
          signed = true;
          log(`signed  TransferTransaction ${event.transactionId} by ${event.payer}`);
          break;
        case "payment_settled":
          log(`settled ${hashscanTxUrl(event.settlement.transaction)}`);
          break;
        case "payment_rejected":
          log(`reject  ${event.status} ${preview(event.body)}`);
          break;
      }
    },
  });
  const payProviderOnly = {
    beforeSign: (paymentRequired: { accepts: { payTo: string }[] }) => {
      const wrongPayee = paymentRequired.accepts.find(a => a.payTo !== info.account);
      if (wrongPayee) {
        throw new Error(`402 asks for payment to ${wrongPayee.payTo}, but the provider account is ${info.account}`);
      }
    },
  };

  let created: Awaited<ReturnType<typeof client.request>>;
  try {
    created = await client.request(
      `${base}/jobs`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jobType: options.jobType, params: options.params }),
      },
      payProviderOnly,
    );
  } catch (error) {
    // Nothing was signed yet, so trying another provider can't double-pay.
    if (!signed) throw new ProviderUnavailableError(base, error);
    throw error;
  }
  if (created.response.status !== 202 || !created.settlement?.success) {
    throw new Error(`job was not accepted: HTTP ${created.response.status} ${preview(created.body)}`);
  }

  const { jobId } = created.body as { jobId: string };
  const payments: JobPayment[] = [{ transactionId: created.settlement.transaction, amountTinybars: tickPrice.toString() }];
  let budgetExhausted = false;
  log(`running job ${jobId}, tick 1 paid (${offer.tickSeconds}s)`);

  const leadS = options.tickLeadSeconds ?? 1;
  const deadline = Date.now() + (options.timeoutMs ?? 15 * 60_000);
  let view: ProviderJobView;
  while (true) {
    view = await fetchJob(base, jobId);
    if (TERMINAL.has(view.status)) break;
    if (Date.now() > deadline) throw new Error(`job ${jobId} did not finish in time`);

    const remainingS = view.paidSeconds - (view.wallClockS ?? 0);
    if (view.status === "running" && !budgetExhausted && remainingS <= leadS) {
      const spent = BigInt(payments.length) * tickPrice;
      if (budget !== undefined && spent + tickPrice > budget) {
        budgetExhausted = true;
        log(`budget  ${formatTinybars(spent)} spent; another tick would exceed ${formatTinybars(budget)}, so no more payments`);
      } else {
        try {
          const tick = await client.request(`${base}/jobs/${jobId}/ticks`, { method: "POST" }, payProviderOnly);
          if (tick.settlement?.success) {
            payments.push({ transactionId: tick.settlement.transaction, amountTinybars: tickPrice.toString() });
            log(`tick    ${payments.length} paid at ${view.wallClockS?.toFixed(1)}s, ${payments.length * offer.tickSeconds}s covered`);
            continue;
          }
          log(`tick    not paid: HTTP ${tick.response.status} ${preview(tick.body)}`);
        } catch (error) {
          log(`tick    payment error: ${error instanceof Error ? error.message : error}`);
        }
      }
    }
    await Bun.sleep(options.pollIntervalMs ?? 500);
  }

  const total = BigInt(payments.length) * tickPrice;
  log(
    `result  ${view.status} after ${view.wallClockS}s, ${payments.length} tick(s) paid (${formatTinybars(total)}) ` +
      (view.error ? `error=${view.error}` : preview(view.result)),
  );

  if (options.confirmOnMirror ?? true) {
    for (const payment of payments) {
      const tx = await waitForMirrorTransaction(payment.transactionId);
      const credited = tx.transfers.find(t => t.account === info.account)?.amount ?? 0;
      payment.mirror = { result: tx.result, consensusTimestamp: tx.consensus_timestamp, creditedTinybars: credited };
      log(`mirror  ${payment.transactionId} ${tx.result}, provider credited ${formatTinybars(BigInt(credited))}`);
    }
  }

  return {
    jobId,
    providerUrl: base,
    providerAccount: info.account,
    jobType: options.jobType,
    status: view.status,
    state: view.state,
    payments,
    totalTinybars: total.toString(),
    tickSeconds: offer.tickSeconds,
    paidTicks: view.paidTicks,
    budgetExhausted,
    wallClockS: view.wallClockS,
    result: view.result,
    error: view.error,
  };
}
