/** Agent job flow: quote → pay (x402) → poll → result, with optional mirror-node confirmation. */
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
  /** Largest single payment the agent will sign, in tinybars. */
  maxTinybarsPerPayment: bigint;
  /** Account the provider must be paid at, e.g. from its registry entry. */
  expectedAccount?: string;
  confirmOnMirror?: boolean;
  pollIntervalMs?: number;
  timeoutMs?: number;
  log?: (line: string) => void;
};

export type JobSummary = {
  jobId: string;
  providerUrl: string;
  providerAccount: string;
  jobType: string;
  status: string;
  transactionIds: string[];
  amountTinybars: string;
  wallClockS?: number;
  result?: unknown;
  error?: string;
  mirror?: { result: string; consensusTimestamp: string; creditedTinybars: number }[];
};

type ProviderInfo = { name: string; account: string; offers: { jobType: string; priceTinybars: string }[] };
type ProviderJobView = { status: string; state: string; wallClockS?: number; result?: unknown; error?: string };

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
  log(`quote   ${info.name} ${info.account} charges ${formatTinybars(offer.priceTinybars)} for ${options.jobType}`);

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

  let paid: Awaited<ReturnType<typeof client.request>>;
  try {
    paid = await client.request(
      `${base}/jobs`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jobType: options.jobType, params: options.params }),
      },
      {
        beforeSign: paymentRequired => {
          const wrongPayee = paymentRequired.accepts.find(a => a.payTo !== info.account);
          if (wrongPayee) {
            throw new Error(`402 asks for payment to ${wrongPayee.payTo}, but the provider account is ${info.account}`);
          }
        },
      },
    );
  } catch (error) {
    // Nothing was signed yet, so trying another provider can't double-pay.
    if (!signed) throw new ProviderUnavailableError(base, error);
    throw error;
  }

  const { response, body, settlement } = paid;
  if (response.status !== 202 || !settlement?.success) {
    throw new Error(`job was not accepted: HTTP ${response.status} ${preview(body)}`);
  }
  const { jobId } = body as { jobId: string };
  log(`running job ${jobId}`);

  const deadline = Date.now() + (options.timeoutMs ?? 10 * 60_000);
  let view: ProviderJobView;
  while (true) {
    view = (await (await fetch(`${base}/jobs/${jobId}`)).json()) as ProviderJobView;
    if (TERMINAL.has(view.status)) break;
    if (Date.now() > deadline) throw new Error(`job ${jobId} did not finish in time`);
    await Bun.sleep(options.pollIntervalMs ?? 1_000);
  }
  log(`result  ${view.status} after ${view.wallClockS}s ${view.error ? `error=${view.error}` : preview(view.result)}`);

  const summary: JobSummary = {
    jobId,
    providerUrl: base,
    providerAccount: info.account,
    jobType: options.jobType,
    status: view.status,
    transactionIds: [settlement.transaction],
    amountTinybars: offer.priceTinybars,
    wallClockS: view.wallClockS,
    result: view.result,
    error: view.error,
  };

  if (options.confirmOnMirror ?? true) {
    summary.mirror = [];
    for (const transactionId of summary.transactionIds) {
      const tx = await waitForMirrorTransaction(transactionId);
      const credited = tx.transfers.find(t => t.account === info.account)?.amount ?? 0;
      summary.mirror.push({ result: tx.result, consensusTimestamp: tx.consensus_timestamp, creditedTinybars: credited });
      log(`mirror  ${transactionId} ${tx.result}, provider credited ${formatTinybars(BigInt(credited))}`);
    }
  }
  return summary;
}
