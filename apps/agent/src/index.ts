/**
 * Agent CLI: pay for one metered GPU job and print the result.
 *
 * The agent signs with its Privy wallet (AGENT_WALLET_ID); no private key is read from anywhere.
 *
 *   bun run agent -- --job mandelbrot --save out/mandelbrot.png        # route via the HCS registry
 *   bun run agent -- --provider http://127.0.0.1:4021 --job benchmark  # use one provider directly
 *   bun run agent -- --job benchmark --budget-hbar 0.2                  # stop paying after 0.2 ℏ
 *   bun run agent -- --provider http://127.0.0.1:4021 --asset 0.0.123 --max-amount 50   # pay in an HTS token
 *
 * Each finished job is recorded on AUDIT_TOPIC_ID (or --audit-topic) when set.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { HBAR_ASSET, hbarToTinybars } from "@decomp/hedera-x402";
import { privyIdentity } from "@decomp/privy-hedera";
import { discoverAndRunJob } from "./route-job";
import { runJob, type JobSummary } from "./run-job";

const { values } = parseArgs({
  options: {
    provider: { type: "string" },
    topic: { type: "string" },
    job: { type: "string", default: "benchmark" },
    params: { type: "string", default: "{}" },
    asset: { type: "string", default: HBAR_ASSET },
    // Budget in the asset's smallest unit, or in HBAR with --budget-hbar.
    budget: { type: "string" },
    "budget-hbar": { type: "string" },
    // Per-payment cap when using --provider: smallest units, or HBAR with --max-hbar.
    "max-amount": { type: "string" },
    "max-hbar": { type: "string", default: "1" },
    "audit-topic": { type: "string" },
    // Write an image result (mandelbrot) to this path.
    save: { type: "string" },
    "skip-mirror": { type: "boolean", default: false },
    json: { type: "boolean", default: false },
  },
});

const log = values.json ? () => {} : console.log;

const HINTS: [RegExp, string][] = [
  [/PRIVY_APP_ID|PRIVY_APP_SECRET/i, "set PRIVY_APP_ID and PRIVY_APP_SECRET from dashboard.privy.io in .env"],
  [/_WALLET_ID|_ACCOUNT_ID/i, "run `bun run setup:privy` to create the Privy wallets and their Hedera accounts"],
  [/Privy API 401|Privy API 403/i, "the Privy app credentials were rejected; check PRIVY_APP_ID and PRIVY_APP_SECRET"],
  [/signature Hedera rejects/i, "the Privy wallet doesn't match the Hedera account it signs for; re-run `bun run setup:privy`"],
  [/TOKEN_NOT_ASSOCIATED/i, "an account isn't associated with the token; run `bun run setup:token`"],
  [/INSUFFICIENT|preflight/i, "check the agent's balance, and its token association when paying in a token"],
  [/spendControls|maxAmountPerPayment/i, "the provider's price is above the agent's per-payment cap (--max-hbar or --max-amount)"],
  [/no eligible provider|does not offer/i, "no running provider offers that job type at that price; is `bun run dev` running?"],
  [/Unable to connect|ECONNREFUSED|unavailable/i, "the provider isn't reachable; start one with `bun run dev`"],
];

/** Why a job that ran didn't succeed, in plain terms, or undefined when it succeeded. */
function describeOutcome(summary: JobSummary): string | undefined {
  if (summary.status === "succeeded") return undefined;
  if (summary.state === "killed_unpaid") {
    return summary.budgetExhausted
      ? "the agent reached its budget and stopped paying, so the provider stopped the job when its paid time ran out"
      : "the provider stopped the job because its paid time ran out";
  }
  if (summary.status === "timeout") return "the job hit the job runner's time limit";
  if (summary.status === "cancelled") return "the provider cancelled the job because its payment didn't settle";
  return summary.error ? `the job failed: ${summary.error}` : `the job ended with status ${summary.status}`;
}

try {
  const asset = values.asset;
  const payingHbar = asset === HBAR_ASSET;
  const identity = await privyIdentity("AGENT");
  const common = {
    jobType: values.job,
    params: JSON.parse(values.params),
    identity,
    maxBudget: values.budget
      ? BigInt(values.budget)
      : values["budget-hbar"]
        ? hbarToTinybars(Number(values["budget-hbar"]))
        : undefined,
    auditTopicId: values["audit-topic"] ?? process.env.AUDIT_TOPIC_ID,
    confirmOnMirror: !values["skip-mirror"],
    log,
  };
  const topicId = values.topic ?? process.env.REGISTRY_TOPIC_ID;
  log(`wallet  ${identity.accountId} signs with Privy wallet ${identity.wallet.walletId}`);

  let summary: JobSummary;
  if (values.provider || !topicId) {
    const maxAmountPerPayment = values["max-amount"]
      ? BigInt(values["max-amount"])
      : payingHbar
        ? hbarToTinybars(Number(values["max-hbar"]))
        : undefined;
    if (maxAmountPerPayment === undefined) {
      throw new Error("--max-amount is required when paying in an HTS token");
    }
    summary = await runJob({
      ...common,
      asset,
      providerUrl: values.provider ?? process.env.PROVIDER_URL ?? "http://127.0.0.1:4021",
      maxAmountPerPayment,
    });
  } else {
    if (!payingHbar) {
      throw new Error("the registry lists HBAR prices only; pass --provider to pay in an HTS token");
    }
    ({ summary } = await discoverAndRunJob({ ...common, topicId }));
  }

  if (values.save) {
    const png = (summary.result as { png_base64?: string } | undefined)?.png_base64;
    if (png) {
      mkdirSync(dirname(values.save), { recursive: true });
      writeFileSync(values.save, Buffer.from(png, "base64"));
      log(`saved   ${values.save}`);
    } else {
      log("saved   nothing: this job returned no image");
    }
  }

  if (values.json) console.log(JSON.stringify(summary));
  const problem = describeOutcome(summary);
  if (problem) console.error(`job did not succeed: ${problem}`);
  process.exit(problem ? 1 : 0);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  const hint = HINTS.find(([pattern]) => pattern.test(message))?.[1];
  console.error(`agent failed: ${message}${hint ? `\nhint: ${hint}` : ""}`);
  process.exit(1);
}
