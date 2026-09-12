/**
 * Phase 2 gate: three providers register on HCS as they boot, discovery filters by job type,
 * routing picks the cheapest eligible provider, and the agent falls back when that provider is
 * down. Starts fresh provider processes, so registration on boot is what gets tested.
 */
import { $, type Subprocess } from "bun";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { readRegistry } from "@decomp/hcs-registry";
import { hederaNetwork, requireEnv } from "@decomp/hedera-x402";
import { privyIdentity } from "@decomp/privy-hedera";
import { discoverAndRunJob, discoverProviders } from "@decomp/agent";
import { allPaymentsSettled, createGate, errorMessage } from "./lib/gate";
import { ROOT, ensureServices, providerService, runnerService, waitForHealthy } from "./lib/services";

const topicId = requireEnv("REGISTRY_TOPIC_ID");
const network = hederaNetwork();
// Prices are tinybars per GPU-second, billed in 5s ticks.
const PROVIDERS = [
  { name: "PROVIDER_1", port: 4021, offers: "benchmark:2000000" },
  { name: "PROVIDER_2", port: 4022, offers: "benchmark:1600000,mandelbrot:4000000" },
  { name: "PROVIDER_3", port: 4023, offers: "mandelbrot:3000000" },
].map(p => ({ ...p, account: requireEnv(`${p.name}_ACCOUNT_ID`) }));

const gate = createGate(2);
const agentLog = (tag: string) => (line: string) => console.log(`   [${tag}] ${line}`);

const stops: Array<() => void> = [];
const processes = new Map<string, Subprocess>();
try {
  stops.push((await ensureServices([runnerService()])).stop);

  const alreadyUp: string[] = [];
  for (const p of PROVIDERS) {
    if (await waitForHealthy(`http://127.0.0.1:${p.port}/health`, 1_000)) alreadyUp.push(p.name);
  }
  if (alreadyUp.length > 0) {
    throw new Error(`stop running providers first, so registration on boot is tested: ${alreadyUp.join(", ")}`);
  }

  const bootSeconds = Math.floor(Date.now() / 1000) - 2;
  const booted = await Promise.all(
    PROVIDERS.map(p => ensureServices([providerService(p.name, p.port, { PROVIDER_OFFERS: p.offers, TICK_SECONDS: "5" })])),
  );
  const readyAt = Date.now();
  booted.forEach(({ stop, started }, i) => {
    stops.push(stop);
    const proc = [...started.values()][0];
    if (proc) processes.set(PROVIDERS[i]!.name, proc);
  });

  const seenAfterMs = new Map<string, number>();
  while (seenAfterMs.size < PROVIDERS.length && Date.now() - readyAt < 30_000) {
    for (const entry of await readRegistry(topicId, { network, afterTimestamp: `${bootSeconds}.0` })) {
      const ours = PROVIDERS.some(p => p.account === entry.hederaAccount);
      if (ours && entry.payerAccountId === entry.hederaAccount && !seenAfterMs.has(entry.hederaAccount)) {
        seenAfterMs.set(entry.hederaAccount, Date.now() - readyAt);
      }
    }
    if (seenAfterMs.size < PROVIDERS.length) await Bun.sleep(1_000);
  }
  const slowestS = Math.max(0, ...seenAfterMs.values()) / 1000;
  gate.record(
    "all 3 providers publish a registration on boot, visible on the mirror node",
    seenAfterMs.size === PROVIDERS.length && slowestS <= 15,
    `${seenAfterMs.size}/3 visible, slowest ${slowestS.toFixed(1)}s after the providers came up`,
  );

  for (const [jobType, expected] of [
    ["benchmark", "PROVIDER_1=2000000,PROVIDER_2=1600000"],
    ["mandelbrot", "PROVIDER_2=4000000,PROVIDER_3=3000000"],
  ] as const) {
    const found = (await discoverProviders(topicId, jobType))
      .map(c => `${c.providerId}=${c.pricePerSecTinybars}`)
      .sort()
      .join(",");
    gate.record(`discovery for ${jobType} returns exactly the providers offering it`, found === expected, found || "none");
  }

  const unit = await $`bun test apps/agent/test packages/hcs-registry/test`.cwd(ROOT).quiet().nothrow();
  const output = unit.stdout.toString() + unit.stderr.toString();
  gate.record(
    "router selects the cheapest eligible provider (unit tests with a mocked registry)",
    unit.exitCode === 0,
    output.match(/\d+ pass[\s\S]*?\d+ fail/)?.[0].replace(/\s+/g, " ") ?? `exit ${unit.exitCode}`,
  );

  const agent = await privyIdentity("AGENT");
  try {
    const { summary, chosen } = await discoverAndRunJob({
      topicId,
      jobType: "mandelbrot",
      params: { width: 512, height: 512, max_iter: 400 },
      identity: agent,
      log: agentLog("route"),
    });
    const png = (summary.result as { png_base64?: string } | undefined)?.png_base64;
    if (png) writeFileSync(join(ROOT, "logs", "phase2-mandelbrot.png"), Buffer.from(png, "base64"));
    gate.record(
      "a live job routes to the cheapest eligible provider and settles",
      chosen.providerId === "PROVIDER_3" && summary.status === "succeeded" && allPaymentsSettled(summary),
      `mandelbrot → ${chosen.providerId} for ${summary.totalAmount} tinybars, ${summary.status}` +
        (png ? ", image at logs/phase2-mandelbrot.png" : ""),
    );
  } catch (error) {
    gate.record("a live job routes to the cheapest eligible provider and settles", false, errorMessage(error));
  }

  const cheapest = processes.get("PROVIDER_2");
  if (!cheapest) {
    gate.record("agent falls back when the cheapest provider is down", false, "PROVIDER_2 was not started by this run");
  } else {
    cheapest.kill();
    await cheapest.exited;
    try {
      const { summary, chosen, skipped } = await discoverAndRunJob({
        topicId,
        jobType: "benchmark",
        params: { duration_s: 2 },
        identity: agent,
        log: agentLog("fallback"),
      });
      const skippedIds = skipped.map(s => s.candidate.providerId).join(", ");
      gate.record(
        "with the cheapest benchmark provider killed, the agent falls back to the next-cheapest",
        skippedIds === "PROVIDER_2" && chosen.providerId === "PROVIDER_1" && summary.status === "succeeded" && allPaymentsSettled(summary),
        `skipped ${skippedIds || "none"}, paid ${chosen.providerId}, ${summary.status}, ` +
          `tx ${summary.payments.map(p => p.transactionId).join(", ")}`,
      );
    } catch (error) {
      gate.record("agent falls back when the cheapest provider is down", false, errorMessage(error));
    }
  }
} catch (error) {
  gate.record("phase 2 setup", false, errorMessage(error));
} finally {
  for (const stop of stops) stop();
}
gate.finish();
