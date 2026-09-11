/**
 * Rebuilds what each provider was paid using only public data: the HCS audit topic and the
 * settlement transactions it lists, both read straight from the mirror node REST API. It is
 * deliberately standalone, with no workspace imports, so it can't inherit a bug from the agent.
 *
 *   bun scripts/reconstruct-audit.ts [--topic 0.0.123] [--since <seconds.nanos>] [--jobs id,id] [--json]
 *
 * Exits non-zero if any record's claimed total differs from what the chain shows, or if a record
 * wasn't published by the agent it names.
 */
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    topic: { type: "string" },
    since: { type: "string" },
    jobs: { type: "string" },
    json: { type: "boolean", default: false },
  },
});

const topic = values.topic ?? process.env.AUDIT_TOPIC_ID;
if (!topic) {
  console.error("pass --topic or set AUDIT_TOPIC_ID");
  process.exit(2);
}
const mirror =
  process.env.MIRROR_NODE_URL ??
  (process.env.HEDERA_NETWORK === "hedera:mainnet" ? "https://mainnet.mirrornode.hedera.com" : "https://testnet.mirrornode.hedera.com");
const onlyJobs = values.jobs ? new Set(values.jobs.split(",").filter(Boolean)) : undefined;
const HBAR = "0.0.0";

type TopicMessage = {
  consensus_timestamp: string;
  message: string;
  payer_account_id: string;
  sequence_number: number;
  chunk_info?: {
    initial_transaction_id: { account_id: string; transaction_valid_start: string; nonce?: number };
    number: number;
    total: number;
  } | null;
};
type Transfer = { account: string; amount: number; token_id?: string };
type MirrorTransaction = { nonce?: number; result: string; transfers: Transfer[]; token_transfers?: Transfer[] };
type AuditRecord = {
  schema: string;
  jobId: string;
  provider: { id: string; account: string };
  agent: string;
  asset: string;
  transactions: string[];
  totalPaid: string;
};
type JobReport = {
  jobId: string;
  sequence: number;
  provider: string;
  providerAccount: string;
  asset: string;
  agent: string;
  publishedBy: string;
  publishedByAgent: boolean;
  claimedTotal: string;
  reconstructedTotal: string;
  matchesClaim: boolean;
  transactions: { id: string; result: string; credited: string }[];
};

async function get<T>(path: string): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${mirror}${path}`, { signal: AbortSignal.timeout(15_000) });
    if (res.ok) return (await res.json()) as T;
    // A 404 usually means the mirror node hasn't ingested the record yet.
    if (res.status !== 404 || attempt === 10) throw new Error(`mirror node returned ${res.status} for ${path}`);
    await Bun.sleep(1_000);
  }
}

async function readTopic(): Promise<TopicMessage[]> {
  const messages: TopicMessage[] = [];
  let path: string | null = `/api/v1/topics/${topic}/messages?order=asc&limit=100${values.since ? `&timestamp=gt:${values.since}` : ""}`;
  while (path) {
    const page: { messages: TopicMessage[]; links: { next: string | null } } = await get(path);
    messages.push(...page.messages);
    path = page.links.next;
  }
  return messages;
}

/** Joins messages HCS split into chunks, keeping the account that paid for each message. */
function wholeMessages(messages: TopicMessage[]): { payer: string; sequence: number; text: string }[] {
  const whole: { payer: string; sequence: number; text: string }[] = [];
  const pending = new Map<string, TopicMessage[]>();
  for (const message of messages) {
    let parts = [message];
    const info = message.chunk_info;
    if (info && info.total > 1) {
      const start = info.initial_transaction_id;
      const key = `${start.account_id}@${start.transaction_valid_start}#${start.nonce ?? 0}`;
      parts = [...(pending.get(key) ?? []), message];
      if (parts.length < info.total) {
        pending.set(key, parts);
        continue;
      }
      pending.delete(key);
      parts.sort((a, b) => (a.chunk_info?.number ?? 0) - (b.chunk_info?.number ?? 0));
    }
    whole.push({
      payer: parts[0]!.payer_account_id,
      sequence: parts[parts.length - 1]!.sequence_number,
      text: Buffer.concat(parts.map(p => Buffer.from(p.message, "base64"))).toString("utf8"),
    });
  }
  return whole;
}

const toMirrorId = (id: string) => {
  const [account, timestamp = ""] = id.split("@");
  return `${account}-${timestamp.replace(".", "-")}`;
};

const counted = new Set<string>();
const jobs: JobReport[] = [];
const totals: Record<string, Record<string, bigint>> = {};

for (const { payer, sequence, text } of wholeMessages(await readTopic())) {
  let record: AuditRecord;
  try {
    record = JSON.parse(text);
  } catch {
    continue;
  }
  if (record?.schema !== "decomp/job-audit@1" || !Array.isArray(record.transactions)) continue;
  if (onlyJobs && !onlyJobs.has(record.jobId)) continue;

  let rebuilt = 0n;
  const transactions: JobReport["transactions"] = [];
  for (const id of record.transactions) {
    // A transaction listed twice, in one record or across records, only paid once.
    if (counted.has(id)) {
      transactions.push({ id, result: "DUPLICATE", credited: "0" });
      continue;
    }
    counted.add(id);
    const { transactions: rows } = await get<{ transactions: MirrorTransaction[] }>(`/api/v1/transactions/${toMirrorId(id)}`);
    const tx = rows.find(r => !r.nonce) ?? rows[0];
    const movements =
      !tx || tx.result !== "SUCCESS"
        ? []
        : record.asset === HBAR
          ? tx.transfers
          : (tx.token_transfers ?? []).filter(t => t.token_id === record.asset);
    const credited = movements.filter(t => t.account === record.provider.account).reduce((sum, t) => sum + BigInt(t.amount), 0n);
    rebuilt += credited;
    transactions.push({ id, result: tx?.result ?? "NOT_FOUND", credited: credited.toString() });
  }

  const byAsset = (totals[record.provider.account] ??= {});
  byAsset[record.asset] = (byAsset[record.asset] ?? 0n) + rebuilt;
  jobs.push({
    jobId: record.jobId,
    sequence,
    provider: record.provider.id,
    providerAccount: record.provider.account,
    asset: record.asset,
    agent: record.agent,
    publishedBy: payer,
    publishedByAgent: payer === record.agent,
    claimedTotal: record.totalPaid,
    reconstructedTotal: rebuilt.toString(),
    matchesClaim: rebuilt.toString() === record.totalPaid,
    transactions,
  });
}

const report = {
  mirror,
  topic,
  jobs,
  totals: Object.fromEntries(
    Object.entries(totals).map(([account, byAsset]) => [
      account,
      Object.fromEntries(Object.entries(byAsset).map(([asset, amount]) => [asset, amount.toString()])),
    ]),
  ),
};

if (values.json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`audit topic ${topic} via ${mirror}\n`);
  for (const job of jobs) {
    const problems = [
      job.matchesClaim ? "" : "claimed total differs from on-chain",
      job.publishedByAgent ? "" : `published by ${job.publishedBy}, not agent ${job.agent}`,
    ].filter(Boolean);
    console.log(
      `#${job.sequence} ${job.jobId} → ${job.provider} (${job.providerAccount}) in ${job.asset === HBAR ? "HBAR" : job.asset}: ` +
        `claimed ${job.claimedTotal}, on-chain ${job.reconstructedTotal} ${problems.length ? `✗ ${problems.join("; ")}` : "✓"}`,
    );
  }
  console.log("\nearned per provider, in smallest units:");
  for (const [account, byAsset] of Object.entries(report.totals)) {
    for (const [asset, amount] of Object.entries(byAsset)) {
      console.log(`  ${account}  ${asset === HBAR ? "HBAR (tinybars)" : asset}  ${amount}`);
    }
  }
}
process.exit(jobs.every(j => j.matchesClaim && j.publishedByAgent) ? 0 : 1);
