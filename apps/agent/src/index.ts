/**
 * Agent CLI: pay for one GPU job and print the result.
 *
 *   bun run agent -- --job benchmark --params '{"duration_s": 3}'    # route via the HCS registry
 *   bun run agent -- --provider http://127.0.0.1:4021 --job benchmark  # use one provider directly
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
    maxTinybarsPerPayment: hbarToTinybars(Number(values["max-hbar"])),
    confirmOnMirror: !values["skip-mirror"],
    log: values.json ? () => {} : console.log,
  };
  const topicId = values.topic ?? process.env.REGISTRY_TOPIC_ID;

  let summary: JobSummary;
  if (values.provider || !topicId) {
    summary = await runJob({ ...common, providerUrl: values.provider ?? process.env.PROVIDER_URL ?? "http://127.0.0.1:4021" });
  } else {
    ({ summary } = await discoverAndRunJob({ ...common, topicId }));
  }

  if (values.json) console.log(JSON.stringify(summary));
  process.exit(summary.status === "succeeded" ? 0 : 1);
} catch (error) {
  console.error(`agent failed: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}
