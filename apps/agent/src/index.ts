/**
 * Agent CLI: pay for one metered GPU job and print the result.
 *
 *   bun run agent -- --job mandelbrot --params '{"width": 1024}'       # route via the HCS registry
 *   bun run agent -- --provider http://127.0.0.1:4021 --job benchmark  # use one provider directly
 *   bun run agent -- --job benchmark --budget-hbar 0.2                  # stop paying after 0.2 ℏ
 */
import { parseArgs } from "node:util";
import { accountFromEnv, hbarToTinybars } from "@decomp/hedera-x402";
import { discoverAndRunJob } from "./route-job";
import { runJob, type JobSummary } from "./run-job";

const { values } = parseArgs({
  options: {
    provider: { type: "string" },
    topic: { type: "string" },
    job: { type: "string", default: "benchmark" },
    params: { type: "string", default: "{}" },
    "budget-hbar": { type: "string" },
    // Per-payment cap when using --provider; routed jobs are capped at the registered tick price.
    "max-hbar": { type: "string", default: "1" },
    "skip-mirror": { type: "boolean", default: false },
    json: { type: "boolean", default: false },
  },
});

try {
  const common = {
    jobType: values.job,
    params: JSON.parse(values.params),
    account: accountFromEnv("AGENT"),
    maxBudgetTinybars: values["budget-hbar"] ? hbarToTinybars(Number(values["budget-hbar"])) : undefined,
    confirmOnMirror: !values["skip-mirror"],
    log: values.json ? () => {} : console.log,
  };
  const topicId = values.topic ?? process.env.REGISTRY_TOPIC_ID;

  let summary: JobSummary;
  if (values.provider || !topicId) {
    summary = await runJob({
      ...common,
      providerUrl: values.provider ?? process.env.PROVIDER_URL ?? "http://127.0.0.1:4021",
      maxTinybarsPerPayment: hbarToTinybars(Number(values["max-hbar"])),
    });
  } else {
    ({ summary } = await discoverAndRunJob({ ...common, topicId }));
  }

  if (values.json) console.log(JSON.stringify(summary));
  process.exit(summary.status === "succeeded" ? 0 : 1);
} catch (error) {
  console.error(`agent failed: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}
