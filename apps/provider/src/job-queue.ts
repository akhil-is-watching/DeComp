/**
 * Metered jobs. A job is paid in ticks of runner-measured wall-clock time, and the provider
 * enforces that itself: a job that runs past its paid window plus a grace period is killed,
 * whatever the agent intends. When a job ends, billed ticks are reconciled against the time the
 * runner measured.
 */
import { tickAmount, type AssetPrice } from "./pricing";
import { TERMINAL_STATUSES, type RunnerClient, type RunnerJob } from "./runner-client";

export type Payment = { tick: number; transaction: string; payer: string; asset: string; amount: string; settledAt: string };

export type JobState =
  /** Job started on a verified first payment that hasn't settled yet. */
  | "awaiting_settlement"
  | "paid"
  | "settlement_failed"
  | "killed_unpaid"
  /** Runner reported a terminal status and billing was reconciled. */
  | "finished";

export type Reconciliation = { wallClockS: number; paidTicks: number; ticksUsed: number; deltaTicks: number };

export type MeteredJob = {
  id: string;
  jobType: string;
  params: Record<string, unknown>;
  tickSeconds: number;
  /** Asset and per-second price, locked in by the payment that created the job. */
  price: AssetPrice;
  createdAt: string;
  state: JobState;
  payments: Payment[];
  /** Tick payments verified but not yet settled; the job isn't reconciled or killed until they land. */
  ticksSettling: number;
  lastRun?: RunnerJob;
  reconciliation?: Reconciliation;
};

export function paidSeconds(job: MeteredJob): number {
  return job.payments.length * job.tickSeconds;
}

/** Ticks a measured runtime used; any started tick counts, and every job uses at least one. */
export function ticksUsed(wallClockS: number, tickSeconds: number): number {
  return Math.max(1, Math.ceil(wallClockS / tickSeconds));
}

export function overdue(elapsedS: number, job: MeteredJob, graceSeconds: number): boolean {
  return elapsedS > paidSeconds(job) + graceSeconds;
}

export class JobQueue {
  private readonly jobs = new Map<string, MeteredJob>();
  private readonly log: (line: string) => void;
  private timer: ReturnType<typeof setInterval> | undefined;
  private sweeping = false;

  constructor(
    private readonly runner: Pick<RunnerClient, "get" | "cancel">,
    private readonly options: { graceSeconds: number; log?: (line: string) => void },
  ) {
    this.log = options.log ?? console.log;
  }

  create(init: { id: string; jobType: string; params: Record<string, unknown>; tickSeconds: number; price: AssetPrice }): MeteredJob {
    const job: MeteredJob = {
      ...init,
      createdAt: new Date().toISOString(),
      state: "awaiting_settlement",
      payments: [],
      ticksSettling: 0,
    };
    this.jobs.set(job.id, job);
    return job;
  }

  /** Call once a tick payment has verified and before it settles. */
  beginTickSettlement(id: string): void {
    this.require(id).ticksSettling++;
  }

  /** Call when that settlement has succeeded (after recordPayment) or failed. */
  endTickSettlement(id: string): void {
    const job = this.require(id);
    job.ticksSettling = Math.max(0, job.ticksSettling - 1);
  }

  get(id: string): MeteredJob | undefined {
    return this.jobs.get(id);
  }

  recordPayment(id: string, settlement: { transaction: string; payer?: string }): Payment {
    const job = this.require(id);
    const payment: Payment = {
      tick: job.payments.length + 1,
      transaction: settlement.transaction,
      payer: settlement.payer ?? "",
      asset: job.price.asset,
      amount: tickAmount(job.price, job.tickSeconds).toString(),
      settledAt: new Date().toISOString(),
    };
    job.payments.push(payment);
    if (job.state === "awaiting_settlement") {
      job.state = "paid";
    } else if (job.state !== "paid") {
      this.log(`job ${id} received tick ${payment.tick} while ${job.state}`);
    }
    return payment;
  }

  async markSettlementFailed(id: string): Promise<void> {
    const job = this.require(id);
    job.state = "settlement_failed";
    await this.runner.cancel(id).catch(error => this.log(`cancel ${id} failed: ${describe(error)}`));
  }

  /** Why a tick payment shouldn't be taken right now, or undefined when it may be. */
  tickRefusal(job: MeteredJob): string | undefined {
    if (job.state !== "paid") return `job is ${job.state}`;
    const run = job.lastRun;
    if (run && TERMINAL_STATUSES.has(run.status)) return `job already ${run.status}`;
    if (paidSeconds(job) - (run?.wall_clock_s ?? 0) >= 2 * job.tickSeconds) {
      return "job is already paid two ticks ahead";
    }
    return undefined;
  }

  start(intervalMs = 500): void {
    this.timer ??= setInterval(() => void this.sweep(), intervalMs);
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  /** One enforcement pass over live jobs. The interval calls this; tests call it directly. */
  async sweep(): Promise<void> {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      for (const job of this.jobs.values()) {
        if (job.reconciliation || job.state === "settlement_failed") continue;

        let run: RunnerJob;
        try {
          run = await this.runner.get(job.id);
        } catch (error) {
          this.log(`could not read job ${job.id} from the runner: ${describe(error)}`);
          continue;
        }
        job.lastRun = run;
        if (job.state === "awaiting_settlement") continue;

        // A tick that verified in time but is still settling must count before billing or killing.
        if (job.ticksSettling > 0) continue;

        if (TERMINAL_STATUSES.has(run.status)) {
          this.reconcile(job, run);
        } else if (job.state === "paid" && overdue(run.wall_clock_s, job, this.options.graceSeconds)) {
          job.state = "killed_unpaid";
          this.log(
            `job ${job.id} ran ${run.wall_clock_s.toFixed(1)}s with ${paidSeconds(job)}s paid ` +
              `(+${this.options.graceSeconds}s grace); killing it`,
          );
          try {
            job.lastRun = await this.runner.cancel(job.id);
          } catch (error) {
            this.log(`cancel ${job.id} failed: ${describe(error)}`);
          }
        }
      }
    } finally {
      this.sweeping = false;
    }
  }

  private reconcile(job: MeteredJob, run: RunnerJob): void {
    const used = ticksUsed(run.wall_clock_s, job.tickSeconds);
    job.reconciliation = {
      wallClockS: run.wall_clock_s,
      paidTicks: job.payments.length,
      ticksUsed: used,
      deltaTicks: job.payments.length - used,
    };
    if (job.state === "paid") job.state = "finished";
    this.log(JSON.stringify({ event: "job_billed", jobId: job.id, status: run.status, state: job.state, ...job.reconciliation }));
  }

  private require(id: string): MeteredJob {
    const job = this.jobs.get(id);
    if (!job) throw new Error(`unknown job ${id}`);
    return job;
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
