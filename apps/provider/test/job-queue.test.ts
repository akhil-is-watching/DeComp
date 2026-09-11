import { beforeEach, describe, expect, test } from "bun:test";
import { JobQueue, overdue, paidSeconds, ticksUsed, type MeteredJob } from "../src/job-queue";
import type { Offer } from "../src/offers";
import type { RunnerJob, RunnerStatus } from "../src/runner-client";

const offer: Offer = { jobType: "benchmark", pricePerSecTinybars: 2_000_000n, tickSeconds: 5 };
const GRACE = 5;

class FakeRunner {
  readonly runs = new Map<string, RunnerJob>();
  readonly cancelled: string[] = [];

  set(id: string, wallClockS: number, status: RunnerStatus = "running") {
    this.runs.set(id, {
      job_id: id,
      job_type: "benchmark",
      params: {},
      status,
      max_runtime_s: 600,
      started_at: 0,
      finished_at: null,
      wall_clock_s: wallClockS,
      result: null,
      error: null,
    });
  }
  async get(id: string) {
    const run = this.runs.get(id);
    if (!run) throw new Error(`no job ${id}`);
    return run;
  }
  async cancel(id: string) {
    this.cancelled.push(id);
    const run = await this.get(id);
    run.status = "killed";
    return run;
  }
}

let runner: FakeRunner;
let queue: JobQueue;
let logs: string[];

beforeEach(() => {
  runner = new FakeRunner();
  logs = [];
  queue = new JobQueue(runner, { graceSeconds: GRACE, log: line => logs.push(line) });
});

function paidJob(id: string, ticks: number): MeteredJob {
  const job = queue.create({ id, jobType: "benchmark", params: {}, offer });
  for (let i = 0; i < ticks; i++) queue.recordPayment(id, { transaction: `0.0.1@${i}.0`, payer: "0.0.9" });
  return job;
}

test("ticksUsed counts any started tick and at least one", () => {
  expect(ticksUsed(0.2, 5)).toBe(1);
  expect(ticksUsed(5, 5)).toBe(1);
  expect(ticksUsed(5.01, 5)).toBe(2);
  expect(ticksUsed(17.6, 5)).toBe(4);
});

test("a job is overdue only past its paid time plus grace", () => {
  const job = paidJob("j", 2);
  expect(paidSeconds(job)).toBe(10);
  expect(overdue(15, job, GRACE)).toBe(false);
  expect(overdue(15.1, job, GRACE)).toBe(true);
});

describe("enforcement", () => {
  test("a job within its paid window plus grace keeps running", async () => {
    paidJob("j", 2);
    runner.set("j", 14.9);
    await queue.sweep();
    expect(runner.cancelled).toEqual([]);
    expect(queue.get("j")!.state).toBe("paid");
  });

  test("a job past its paid window plus grace is killed by the provider", async () => {
    paidJob("j", 1);
    runner.set("j", 10.2);
    await queue.sweep();
    expect(runner.cancelled).toEqual(["j"]);
    expect(queue.get("j")!.state).toBe("killed_unpaid");
  });

  test("a job whose first payment is still settling is never killed", async () => {
    queue.create({ id: "j", jobType: "benchmark", params: {}, offer });
    runner.set("j", 60);
    await queue.sweep();
    expect(runner.cancelled).toEqual([]);
  });

  test("a killed job is reconciled once the runner reports it stopped", async () => {
    paidJob("j", 2);
    runner.set("j", 15.4);
    await queue.sweep();
    await queue.sweep();
    expect(queue.get("j")!.reconciliation).toEqual({ wallClockS: 15.4, paidTicks: 2, ticksUsed: 4, deltaTicks: -2 });
  });
});

describe("reconciliation", () => {
  test("a finished job's billed ticks are compared to measured wall-clock", async () => {
    paidJob("j", 4);
    runner.set("j", 17.6, "succeeded");
    await queue.sweep();
    const job = queue.get("j")!;
    expect(job.state).toBe("finished");
    expect(job.reconciliation).toEqual({ wallClockS: 17.6, paidTicks: 4, ticksUsed: 4, deltaTicks: 0 });
    expect(logs.some(l => l.includes('"event":"job_billed"'))).toBe(true);
  });
});

describe("tick refusals", () => {
  test("accepts a tick for a running, paid job", async () => {
    paidJob("j", 1);
    runner.set("j", 4);
    await queue.sweep();
    expect(queue.tickRefusal(queue.get("j")!)).toBeUndefined();
  });

  test("refuses ticks for jobs that already ended", async () => {
    paidJob("j", 1);
    runner.set("j", 3, "succeeded");
    await queue.sweep();
    expect(queue.tickRefusal(queue.get("j")!)).toBe("job is finished");
  });

  test("refuses to take payment more than two ticks ahead", async () => {
    paidJob("j", 3);
    runner.set("j", 4);
    await queue.sweep();
    expect(queue.tickRefusal(queue.get("j")!)).toBe("job is already paid two ticks ahead");
  });

  test("refuses ticks for jobs killed for non-payment", async () => {
    paidJob("j", 1);
    runner.set("j", 11);
    await queue.sweep();
    expect(queue.tickRefusal(queue.get("j")!)).toBe("job is killed_unpaid");
  });
});
