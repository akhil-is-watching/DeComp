/**
 * Agent CLI: pay for one metered GPU job and print the result.
 *
 *   bun run agent -- --job mandelbrot --params '{"width": 1024}'       # route via the HCS registry
 *   bun run agent -- --provider http://127.0.0.1:4021 --job benchmark  # use one provider directly
 *   bun run agent -- --job benchmark --budget-hbar 0.2                  # stop paying after 0.2 ℏ
 *   bun run agent -- --provider http://127.0.0.1:4021 --asset 0.0.123 --max-amount 50   # pay in an HTS token
 *
 * Each finished job is recorded on AUDIT_TOPIC_ID (or --audit-topic) when set.
 */
import { parseArgs } from "node:util";
import { HBAR_ASSET, accountFromEnv, hbarToTinybars } from "@decomp/hedera-x402";
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
    "skip-mirror": { type: "boolean", default: false },
    json: { type: "boolean", default: false },
  },
});

try {
  const asset = values.asset;
  const payingHbar = asset === HBAR_ASSET;
  const common = {
    jobType: values.job,
    params: JSON.parse(values.params),
    account: accountFromEnv("AGENT"),
    maxBudget: values.budget
      ? BigInt(values.budget)
      : values["budget-hbar"]
        ? hbarToTinybars(Number(values["budget-hbar"]))
        : undefined,
    auditTopicId: values["audit-topic"] ?? process.env.AUDIT_TOPIC_ID,
    confirmOnMirror: !values["skip-mirror"],
    log: values.json ? () => {} : console.log,
  };
  const topicId = values.topic ?? process.env.REGISTRY_TOPIC_ID;

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

  if (values.json) console.log(JSON.stringify(summary));
  process.exit(summary.status === "succeeded" ? 0 : 1);
} catch (error) {
  console.error(`agent failed: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}
