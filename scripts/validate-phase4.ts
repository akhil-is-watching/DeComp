/**
 * Phase 4 gate: the agent and provider are associated with the compute token before anything is
 * paid in it; a token payment passes /verify; one full metered job is paid entirely in the token;
 * every finished job leaves a complete audit record on HCS; and a standalone script rebuilds each
 * provider's earnings from HCS and the mirror node to match the agent's own numbers.
 */
import { $ } from "bun";
import { decodePaymentRequiredHeader } from "@x402/core/http";
import { readAudits, type AuditEntry } from "@decomp/hcs-registry";
import {
  HBAR_ASSET,
  createFacilitatorClient,
  createPayingClient,
  getTokenBalance,
  hederaNetwork,
  paymentTransactionId,
  requireEnv,
} from "@decomp/hedera-x402";
import { privyIdentity } from "@decomp/privy-hedera";
import { runJob, type JobSummary } from "@decomp/agent";
import { allPaymentsSettled, createGate, errorMessage } from "./lib/gate";
import { ROOT, ensureServices, providerService, runnerService } from "./lib/services";

const auditTopicId = requireEnv("AUDIT_TOPIC_ID");
const tokenId = requireEnv("COMPUTE_TOKEN_ID");
const providerAccount = requireEnv("PROVIDER_1_ACCOUNT_ID");
const network = hederaNetwork();
const PORT = 4041;
const providerUrl = `http://127.0.0.1:${PORT}`;
const TICK_SECONDS = 5;
const HBAR_PER_SEC = 1_000_000n; // 0.05 ℏ per tick
const TOKEN_PER_SEC = 5n; // 0.25 DCC per tick
const JOB = { jobType: "benchmark", params: { duration_s: 12 } }; // three 5s ticks

const gate = createGate(4);
const agent = await privyIdentity("AGENT");
const agentLog = (tag: string) => (line: string) => console.log(`   [${tag}] ${line}`);

async function waitForAudit(jobId: string, afterTimestamp: string): Promise<AuditEntry | undefined> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const entry = (await readAudits(auditTopicId, { network, afterTimestamp })).find(a => a.jobId === jobId);
    if (entry) return entry;
    await Bun.sleep(1_000);
  }
  return undefined;
}

/** Order-independent form of { account: { asset: amount } } for comparison. */
function canonical(totals: Record<string, Record<string, string>>): string {
  return JSON.stringify(
    Object.keys(totals)
      .sort()
      .map(account => [account, Object.entries(totals[account]!).sort()]),
  );
}

for (const [role, accountId] of [
  ["AGENT", agent.accountId],
  ["PROVIDER_1", providerAccount],
] as const) {
  const balance = await getTokenBalance(accountId, tokenId);
  gate.record(
    `${role} is associated with compute token ${tokenId} before any token payment`,
    balance !== null,
    balance === null ? `${accountId} is not associated; run bun run setup:token` : `${accountId} holds ${balance} units`,
  );
}

const startedAt = `${Math.floor(Date.now() / 1000) - 2}.0`;
const summaries: JobSummary[] = [];
const { stop } = await ensureServices([
  runnerService(),
  providerService("PROVIDER_1", PORT, {
    PROVIDER_OFFERS: `benchmark:${HBAR_PER_SEC}`,
    PROVIDER_TOKEN_OFFERS: `benchmark:${TOKEN_PER_SEC}`,
    TICK_SECONDS: String(TICK_SECONDS),
    // Test pricing must not replace PROVIDER_1's real registry entry.
    REGISTRY_TOPIC_ID: "",
  }),
]);
try {
  const challenge = await fetch(`${providerUrl}/jobs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(JOB),
  });
  const header = challenge.headers.get("PAYMENT-REQUIRED");
  const paymentRequired = header ? decodePaymentRequiredHeader(header) : undefined;
  const offered = paymentRequired?.accepts ?? [];
  const tokenOption = offered.find(r => r.asset === tokenId);
  gate.record(
    "the 402 offers the compute token alongside HBAR",
    challenge.status === 402 && Boolean(tokenOption) && offered.some(r => r.asset === HBAR_ASSET),
    `HTTP ${challenge.status}, offered ${offered.map(r => `${r.amount} of ${r.asset}`).join(" or ") || "nothing"}`,
  );

  if (paymentRequired && tokenOption) {
    try {
      const client = createPayingClient({
        signer: agent.paymentSigner,
        allowedAssets: [{ asset: tokenId, maxAmountPerPayment: BigInt(tokenOption.amount) }],
        preferredAsset: tokenId,
      });
      const payload = await client.createPayload(paymentRequired);
      const verify = await createFacilitatorClient().verify(payload, payload.accepted);
      gate.record(
        "a Privy-signed payment in the compute token passes facilitator /verify",
        verify.isValid && payload.accepted.asset === tokenId,
        `${paymentTransactionId(payload)} for ${payload.accepted.amount} of ${payload.accepted.asset}, isValid=${verify.isValid}` +
          (verify.invalidReason ? ` ${verify.invalidReason}: ${verify.invalidMessage ?? ""}` : ""),
      );
    } catch (error) {
      gate.record("a Privy-signed payment in the compute token passes facilitator /verify", false, errorMessage(error));
    }
  }

  for (const [label, asset, perSecond] of [
    ["token", tokenId, TOKEN_PER_SEC],
    ["hbar", HBAR_ASSET, HBAR_PER_SEC],
  ] as const) {
    const name =
      asset === HBAR_ASSET
        ? "a metered HBAR job settles every tick"
        : "a full metered job is paid entirely in the compute token, every tick verified and settled";
    try {
      const summary = await runJob({
        providerUrl,
        ...JOB,
        identity: agent,
        asset,
        maxAmountPerPayment: perSecond * BigInt(TICK_SECONDS),
        auditTopicId,
        log: agentLog(label),
      });
      summaries.push(summary);
      gate.record(
        name,
        summary.status === "succeeded" &&
          summary.payments.length >= 2 &&
          summary.payments.every(p => p.asset === asset) &&
          allPaymentsSettled(summary),
        `${summary.payments.length} ticks of ${summary.payments[0]?.amount} ${asset === HBAR_ASSET ? "tinybars" : `units of ${asset}`}; ` +
          `mirror: ${summary.payments.map(p => p.mirror?.result).join(", ")}`,
      );
    } catch (error) {
      gate.record(name, false, errorMessage(error));
    }
  }

  for (const summary of summaries) {
    const entry = await waitForAudit(summary.jobId, startedAt);
    const complete =
      entry !== undefined &&
      entry.payerAccountId === agent.accountId &&
      entry.agent === agent.accountId &&
      entry.provider.id === summary.providerId &&
      entry.provider.account === summary.providerAccount &&
      JSON.stringify(entry.transactions) === JSON.stringify(summary.payments.map(p => p.transactionId)) &&
      entry.totalPaid === summary.totalAmount &&
      entry.wallClockS === summary.wallClockS &&
      entry.asset === summary.asset;
    gate.record(
      `${summary.asset === HBAR_ASSET ? "HBAR" : "token"} job has a complete audit record on HCS`,
      complete,
      entry
        ? `job ${summary.jobId} at seq ${entry.sequenceNumber}: ${entry.provider.id} ${entry.provider.account}, ` +
            `${entry.transactions.length} tick tx ids, total ${entry.totalPaid}, ${entry.wallClockS}s, published by ${entry.payerAccountId}`
        : `no audit record for ${summary.jobId}`,
    );
  }

  if (summaries.length > 0) {
    const jobIds = summaries.map(s => s.jobId).join(",");
    const rebuilt = await $`bun scripts/reconstruct-audit.ts --topic ${auditTopicId} --since ${startedAt} --jobs ${jobIds} --json`
      .cwd(ROOT)
      .quiet()
      .nothrow();
    const name = "a standalone script rebuilds per-provider spend from HCS and the mirror node, matching the agent";
    try {
      const report = JSON.parse(rebuilt.stdout.toString()) as {
        jobs: { jobId: string; reconstructedTotal: string }[];
        totals: Record<string, Record<string, string>>;
      };
      const expected: Record<string, Record<string, string>> = {};
      for (const s of summaries) {
        const byAsset = (expected[s.providerAccount] ??= {});
        byAsset[s.asset] = (BigInt(byAsset[s.asset] ?? "0") + BigInt(s.totalAmount)).toString();
      }
      const everyJobMatches = summaries.every(s => report.jobs.find(j => j.jobId === s.jobId)?.reconstructedTotal === s.totalAmount);
      gate.record(
        name,
        rebuilt.exitCode === 0 && everyJobMatches && report.jobs.length === summaries.length && canonical(report.totals) === canonical(expected),
        `rebuilt ${JSON.stringify(report.totals)}; agent reported ${JSON.stringify(expected)}`,
      );
    } catch (error) {
      gate.record(name, false, `${errorMessage(error)}; ${rebuilt.stderr.toString().trim().slice(-300)}`);
    }
  }
} catch (error) {
  gate.record("phase 4 setup", false, errorMessage(error));
} finally {
  stop();
}
gate.finish();
