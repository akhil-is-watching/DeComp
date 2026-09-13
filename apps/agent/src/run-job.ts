/**
 * Agent job flow: quote → pay the first tick (x402) → keep paying a tick just before each paid
 * window runs out → result → audit record on HCS. The agent can stop paying at a budget ceiling;
 * the provider then stops the job itself.
 *
 * Every signature is made by the identity's Privy wallet; no key exists on this machine.
 */
import {
  HBAR_ASSET,
  createPayingClient,
  creditedAmount,
  formatTinybars,
  hashscanTxUrl,
  waitForMirrorTransaction,
} from "@decomp/hedera-x402";
import type { HederaIdentity } from "@decomp/privy-hedera";
import { publishJobAudit } from "./audit";
import { ProviderUnavailableError } from "./router";

export type RunJobOptions = {
  providerUrl: string;
  jobType: string;
  params: Record<string, unknown>;
  /** Who pays: a Privy wallet bound to a Hedera account. */
  identity: HederaIdentity;
  /** "0.0.0" for HBAR (the default) or an HTS token id the provider prices in. */
  asset?: string;
  /** Largest single payment (one tick) the agent will sign, in the asset's smallest unit. */
  maxAmountPerPayment: bigint;
  /** Most the agent will spend on this job, in the asset's smallest unit; it stops paying beyond this. */
  maxBudget?: bigint;
  /** Pay the next tick when this many paid seconds remain; the provider's grace period covers settlement. */
  tickLeadSeconds?: number;
  /** Account the provider must be paid at, e.g. from its registry entry. */
  expectedAccount?: string;
  /** HCS topic that receives the job's audit record once it ends. */
  auditTopicId?: string;
  confirmOnMirror?: boolean;
  pollIntervalMs?: number;
  timeoutMs?: number;
  log?: (line: string) => void;
};

export type JobPayment = {
  transactionId: string;
  asset: string;
  /** In the asset's smallest unit. */
  amount: string;
  mirror?: { result: string; consensusTimestamp: string; credited: string };
};

export type JobSummary = {
  jobId: string;
  providerId: string;
  providerUrl: string;
  providerAccount: string;
  network: string;
  jobType: string;
  /** Runner status, e.g. succeeded or killed. */
  status: string;
  /** Provider billing state, e.g. finished or killed_unpaid. */
  state: string;
  asset: string;
  payments: JobPayment[];
  totalAmount: string;
  tickSeconds: number;
  /** Ticks the provider recorded as paid. */
  paidTicks: number;
  budgetExhausted: boolean;
  wallClockS?: number;
  result?: unknown;
  error?: string;
  audit?: { topicId: string; sequenceNumber: number; transactionId: string };
};

type ProviderPrice = { asset: string; perSecond: string; tickAmount: string; label: string };
type ProviderOffer = { jobType: string; tickSeconds: number; prices: ProviderPrice[] };
type ProviderInfo = { name: string; account: string; network: string; offers: ProviderOffer[] };
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

/** The x402 or provider error message in a rejection body, falling back to a preview of the body. */
function rejectionDetail(body: unknown): string {
  const error = (body as { error?: unknown } | null | undefined)?.error;
  return typeof error === "string" ? error : preview(body);
}

function describeAmount(asset: string, amount: bigint): string {
  return asset === HBAR_ASSET ? formatTinybars(amount) : `${amount} units of ${asset}`;
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
  const asset = options.asset ?? HBAR_ASSET;

  const info = await fetchInfo(base);
  if (options.expectedAccount && info.account !== options.expectedAccount) {
    throw new ProviderUnavailableError(base, new Error(`serves account ${info.account}, expected ${options.expectedAccount}`));
  }
  const offer = info.offers.find(o => o.jobType === options.jobType);
  const price = offer?.prices.find(p => p.asset === asset);
  if (!offer || !price) {
    throw new ProviderUnavailableError(base, new Error(`${info.name} does not offer ${options.jobType} priced in ${asset}`));
  }
  const tickAmount = BigInt(price.tickAmount);
  const budget = options.maxBudget;
  if (budget !== undefined && tickAmount > budget) {
    throw new ProviderUnavailableError(
      base,
      new Error(`one tick costs ${describeAmount(asset, tickAmount)}, above the ${describeAmount(asset, budget)} budget`),
    );
  }
  // The spend controls would refuse this anyway, but with an error that doesn't say why. When
  // routing, the cap is the registered price, so this is a provider charging more than it listed.
  if (tickAmount > options.maxAmountPerPayment) {
    throw new ProviderUnavailableError(
      base,
      new Error(
        `one tick costs ${describeAmount(asset, tickAmount)}, above the ${describeAmount(asset, options.maxAmountPerPayment)} ` +
          (options.expectedAccount ? "its registry listing advertises" : "per-payment cap"),
      ),
    );
  }
  log(`quote   ${info.name} ${info.account} charges ${price.label}/s, billed in ${offer.tickSeconds}s ticks of ${describeAmount(asset, tickAmount)}`);

  let signed = false;
  const client = createPayingClient({
    signer: options.identity.paymentSigner,
    allowedAssets: [{ asset, maxAmountPerPayment: options.maxAmountPerPayment }],
    preferredAsset: asset,
    onEvent: event => {
      switch (event.type) {
        case "payment_required": {
          const offered = event.paymentRequired.accepts.map(r => `${r.amount} of ${r.asset}`).join(" or ");
          log(`402     pay ${offered} to ${event.paymentRequired.accepts[0]?.payTo} (feePayer ${event.paymentRequired.accepts[0]?.extra?.feePayer})`);
          break;
        }
        case "payment_signed":
          signed = true;
          log(`signed  TransferTransaction ${event.transactionId} for ${event.requirements.amount} of ${event.requirements.asset} by ${event.payer} (Privy wallet ${options.identity.wallet.walletId})`);
          break;
        case "payment_settled":
          log(`settled ${hashscanTxUrl(event.settlement.transaction)}`);
          break;
        case "payment_rejected":
          log(`reject  HTTP ${event.status}: ${rejectionDetail(event.body)}`);
          break;
      }
    },
  });
  const payProviderInAsset = {
    beforeSign: (paymentRequired: { accepts: { payTo: string; asset: string }[] }) => {
      const wrongPayee = paymentRequired.accepts.find(a => a.payTo !== info.account);
      if (wrongPayee) {
        throw new Error(`402 asks for payment to ${wrongPayee.payTo}, but the provider account is ${info.account}`);
      }
      if (!paymentRequired.accepts.some(a => a.asset === asset)) {
        throw new Error(`402 does not accept ${asset}`);
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
      payProviderInAsset,
    );
  } catch (error) {
    // Nothing was signed yet, so trying another provider can't double-pay.
    if (!signed) throw new ProviderUnavailableError(base, error);
    throw error;
  }
  if (created.response.status !== 202 || !created.settlement?.success) {
    throw new Error(`job was not accepted: HTTP ${created.response.status}: ${rejectionDetail(created.body)}`);
  }

  const { jobId } = created.body as { jobId: string };
  const payments: JobPayment[] = [{ transactionId: created.settlement.transaction, asset, amount: tickAmount.toString() }];
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
      const spent = BigInt(payments.length) * tickAmount;
      if (budget !== undefined && spent + tickAmount > budget) {
        budgetExhausted = true;
        log(`budget  ${describeAmount(asset, spent)} spent; another tick would exceed ${describeAmount(asset, budget)}, so no more payments`);
      } else {
        try {
          const tick = await client.request(`${base}/jobs/${jobId}/ticks`, { method: "POST" }, payProviderInAsset);
          if (tick.settlement?.success) {
            payments.push({ transactionId: tick.settlement.transaction, asset, amount: tickAmount.toString() });
            log(`tick    ${payments.length} paid at ${view.wallClockS?.toFixed(1)}s, ${payments.length * offer.tickSeconds}s covered`);
            continue;
          }
          log(`tick    not paid: HTTP ${tick.response.status}: ${rejectionDetail(tick.body)}`);
        } catch (error) {
          log(`tick    payment error: ${error instanceof Error ? error.message : error}`);
        }
      }
    }
    await Bun.sleep(options.pollIntervalMs ?? 500);
  }

  const total = BigInt(payments.length) * tickAmount;
  log(
    `result  ${view.status} after ${view.wallClockS}s, ${payments.length} tick(s) paid (${describeAmount(asset, total)}) ` +
      (view.error ? `error=${view.error}` : preview(view.result)),
  );

  if (options.confirmOnMirror ?? true) {
    for (const payment of payments) {
      const tx = await waitForMirrorTransaction(payment.transactionId);
      const credited = creditedAmount(tx, info.account, asset);
      payment.mirror = { result: tx.result, consensusTimestamp: tx.consensus_timestamp, credited: credited.toString() };
      log(`mirror  ${payment.transactionId} ${tx.result}, provider credited ${describeAmount(asset, credited)}`);
    }
  }

  const summary: JobSummary = {
    jobId,
    providerId: info.name,
    providerUrl: base,
    providerAccount: info.account,
    network: info.network,
    jobType: options.jobType,
    status: view.status,
    state: view.state,
    asset,
    payments,
    totalAmount: total.toString(),
    tickSeconds: offer.tickSeconds,
    paidTicks: view.paidTicks,
    budgetExhausted,
    wallClockS: view.wallClockS,
    result: view.result,
    error: view.error,
  };

  if (options.auditTopicId) {
    try {
      const published = await publishJobAudit(options.auditTopicId, options.identity, summary);
      summary.audit = { topicId: options.auditTopicId, ...published };
      log(`audit   recorded on HCS topic ${options.auditTopicId} (seq ${published.sequenceNumber}, tx ${published.transactionId})`);
    } catch (error) {
      log(`audit   publish failed: ${error instanceof Error ? error.message : error}`);
    }
  }
  return summary;
}
