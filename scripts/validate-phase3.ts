/**
 * Phase 3 gate: a job type genuinely runs >10s on the GPU, one paid job settles at least three
 * separate ticks on-chain, billed ticks match the runner's measured wall-clock within one tick,
 * and a job whose agent stops paying at its budget is killed by the provider on its own.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runJob } from "@decomp/agent";
import { privyIdentity } from "@decomp/privy-hedera";
import { RunnerClient, TERMINAL_STATUSES, type RunnerJob } from "../apps/provider/src/runner-client";
import { allPaymentsSettled, createGate, errorMessage } from "./lib/gate";
import { ROOT, ensureServices, providerService, runnerService } from "./lib/services";

const TICK_SECONDS = 5;
const GRACE_SECONDS = 5;
const PRICE_PER_SEC = 1_000_000n; // 0.01 ℏ per GPU-second
const TICK_PRICE = PRICE_PER_SEC * BigInt(TICK_SECONDS);
const PORT = 4031;
const providerUrl = `http://127.0.0.1:${PORT}`;
// About 20s of GPU time on an M4.
const LONG_JOB = { jobType: "mandelbrot", params: { width: 2048, height: 2048, max_iter: 3500 } };

const gate = createGate(3);
const agent = await privyIdentity("AGENT");
const agentLog = (tag: string) => (line: string) => console.log(`   [${tag}] ${line}`);

/** The runner's own job_finished metering line for a job, from the log of the runner this gate started. */
async function runnerLogEntry(jobId: string): Promise<{ status: string; wall_clock_s: number } | undefined> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const line = readFileSync(join(ROOT, "logs", "job-runner.log"), "utf8")
      .split("\n")
      .find(l => l.includes('"job_finished"') && l.includes(jobId));
    if (line) return JSON.parse(line.slice(line.indexOf("{")));
    await Bun.sleep(300);
  }
  return undefined;
}

const services = await ensureServices([
  runnerService(),
  providerService("PROVIDER_1", PORT, {
    PROVIDER_OFFERS: `mandelbrot:${PRICE_PER_SEC}`,
    TICK_SECONDS: String(TICK_SECONDS),
    TICK_GRACE_SECONDS: String(GRACE_SECONDS),
    // Test pricing must not replace PROVIDER_1's real registry entry.
    REGISTRY_TOPIC_ID: "",
  }),
]);
try {
  if (!services.started.has("job-runner")) {
    throw new Error("stop the running job runner first; this gate reads the log of a runner it starts itself");
  }

  {
    const runner = new RunnerClient("http://127.0.0.1:8100");
    const jobId = `phase3-timing-${Date.now()}`;
    const startedAt = performance.now();
    await runner.submit({ jobId, ...LONG_JOB, maxRuntimeS: 120 });
    let run: RunnerJob;
    do {
      await Bun.sleep(250);
      run = await runner.get(jobId);
    } while (!TERMINAL_STATUSES.has(run.status));
    const timedS = (performance.now() - startedAt) / 1000;
    const result = run.result as { compute_s?: number; device?: string } | null;
    gate.record(
      "a job type runs >10s of GPU time, timed directly rather than from ticks",
      run.status === "succeeded" && (result?.compute_s ?? 0) > 10 && timedS > 10 && /gpu/i.test(result?.device ?? ""),
      `mandelbrot ${result?.compute_s}s of compute on ${result?.device}; runner wall-clock ${run.wall_clock_s}s; ` +
        `timed from outside ${timedS.toFixed(1)}s`,
    );
  }

  try {
    const summary = await runJob({
      providerUrl,
      ...LONG_JOB,
      identity: agent,
      maxAmountPerPayment: TICK_PRICE,
      log: agentLog("metered"),
    });
    const ids = new Set(summary.payments.map(p => p.transactionId));
    gate.record(
      "one job produces at least 3 separate on-chain settlements",
      summary.status === "succeeded" && ids.size >= 3 && ids.size === summary.payments.length && allPaymentsSettled(summary),
      `${ids.size} tick settlements, mirror: ${summary.payments.map(p => p.mirror?.result).join(", ")}`,
    );

    // The provider's own billing record, which must count every tick the agent paid, including one
    // that was still settling when the job finished.
    let billed: { paidTicks: number; ticksUsed: number } | undefined;
    for (let attempt = 0; attempt < 20 && !billed; attempt++) {
      const view = (await (await fetch(`${providerUrl}/jobs/${summary.jobId}`)).json()) as { reconciliation?: typeof billed };
      billed = view.reconciliation;
      if (!billed) await Bun.sleep(500);
    }
    const logged = await runnerLogEntry(summary.jobId);
    const used = logged ? Math.max(1, Math.ceil(logged.wall_clock_s / TICK_SECONDS)) : NaN;
    gate.record(
      "billed ticks match the runner's measured wall-clock within ±1 tick",
      logged !== undefined && billed !== undefined && billed.paidTicks === summary.payments.length && Math.abs(billed.paidTicks - used) <= 1,
      logged
        ? `runner logged ${logged.wall_clock_s}s → ${used} ticks used; provider reconciled ` +
            (billed ? `${billed.paidTicks} paid vs ${billed.ticksUsed} used` : "nothing") +
            `; agent paid ${summary.payments.length}`
        : "no job_finished line in logs/job-runner.log",
    );
  } catch (error) {
    gate.record("metered job settles multiple ticks", false, errorMessage(error));
  }

  try {
    const budget = TICK_PRICE * 2n;
    const summary = await runJob({
      providerUrl,
      ...LONG_JOB,
      identity: agent,
      maxAmountPerPayment: TICK_PRICE,
      maxBudget: budget,
      log: agentLog("budget"),
    });
    gate.record(
      "agent stops paying at its budget ceiling",
      summary.budgetExhausted && summary.payments.length === 2 && BigInt(summary.totalAmount) <= budget,
      `${summary.payments.length} ticks paid, ${summary.totalAmount} of a ${budget} tinybar budget`,
    );

    const logged = await runnerLogEntry(summary.jobId);
    const paidS = summary.payments.length * TICK_SECONDS;
    gate.record(
      "provider kills the unpaid job on its own",
      summary.state === "killed_unpaid" &&
        logged?.status === "killed" &&
        logged.wall_clock_s > paidS &&
        logged.wall_clock_s <= paidS + GRACE_SECONDS + 1.5,
      `provider state ${summary.state}; runner logged ${logged?.status} after ${logged?.wall_clock_s}s ` +
        `with ${paidS}s paid + ${GRACE_SECONDS}s grace`,
    );
  } catch (error) {
    gate.record("budget ceiling and provider enforcement", false, errorMessage(error));
  }
} catch (error) {
  gate.record("phase 3 setup", false, errorMessage(error));
} finally {
  services.stop();
}
gate.finish();
