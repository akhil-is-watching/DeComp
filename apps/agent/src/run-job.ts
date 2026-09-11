/** Agent job flow: quote → pay (x402) → poll → result, with optional mirror-node confirmation. */
import {
  createPayingClient,
  formatTinybars,
  hashscanTxUrl,
  waitForMirrorTransaction,
  type AccountCredentials,
} from "@decomp/hedera-x402";

export type RunJobOptions = {
  providerUrl: string;
  jobType: string;
  params: Record<string, unknown>;
  account: AccountCredentials;
  maxTinybarsPerPayment: bigint;
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

export async function runJob(options: RunJobOptions): Promise<JobSummary> {
  const log = options.log ?? console.log;
  const base = options.providerUrl.replace(/\/$/, "");

  const info = (await (await fetch(`${base}/info`, { signal: AbortSignal.timeout(5_000) })).json()) as ProviderInfo;
  const offer = info.offers.find(o => o.jobType === options.jobType);
  if (!offer) {
    throw new Error(`${info.name} does not offer ${options.jobType} (offers: ${info.offers.map(o => o.jobType).join(", ")})`);
  }
  log(`quote   ${info.name} ${info.account} charges ${formatTinybars(offer.priceTinybars)} for ${options.jobType}`);

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
          log(`signed  TransferTransaction ${event.transactionId} by ${event.payer}`);
          break;
        case "payment_settled":
          log(`settled ${hashscanTxUrl(event.settlement.transaction)}`);
          break;
        case "payment_rejected":
          log(`reject  ${event.status} ${JSON.stringify(event.body)}`);
          break;
      }
    },
  });

  const { response, body, settlement } = await client.request(`${base}/jobs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jobType: options.jobType, params: options.params }),
  });
  if (response.status !== 202 || !settlement?.success) {
    throw new Error(`job was not accepted: HTTP ${response.status} ${JSON.stringify(body)}`);
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
  log(`result  ${view.status} after ${view.wallClockS}s ${view.error ? `error=${view.error}` : JSON.stringify(view.result)}`);

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
