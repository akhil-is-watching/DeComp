/**
 * Agent CLI: pay a provider for one GPU job and print the result.
 *
 *   bun run agent -- --job benchmark --params '{"duration_s": 3}'
 */
import { parseArgs } from "node:util";
import { accountFromEnv, hbarToTinybars } from "@decomp/hedera-x402";
import { runJob } from "./run-job";

const { values } = parseArgs({
  options: {
    provider: { type: "string", default: process.env.PROVIDER_URL ?? "http://127.0.0.1:4021" },
    job: { type: "string", default: "benchmark" },
    params: { type: "string", default: "{}" },
    "max-hbar": { type: "string", default: "1" },
    "skip-mirror": { type: "boolean", default: false },
    json: { type: "boolean", default: false },
  },
});

try {
  const summary = await runJob({
    providerUrl: values.provider,
    jobType: values.job,
    params: JSON.parse(values.params),
    account: accountFromEnv("AGENT"),
    maxTinybarsPerPayment: hbarToTinybars(Number(values["max-hbar"])),
    confirmOnMirror: !values["skip-mirror"],
    log: values.json ? () => {} : console.log,
  });
  if (values.json) console.log(JSON.stringify(summary));
  process.exit(summary.status === "succeeded" ? 0 : 1);
} catch (error) {
  console.error(`agent failed: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}
