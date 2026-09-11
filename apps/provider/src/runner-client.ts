export type RunnerStatus = "queued" | "running" | "succeeded" | "failed" | "killed" | "timeout";
export const TERMINAL_STATUSES: ReadonlySet<RunnerStatus> = new Set(["succeeded", "failed", "killed", "timeout"]);

export type RunnerJob = {
  job_id: string;
  job_type: string;
  params: Record<string, unknown>;
  status: RunnerStatus;
  max_runtime_s: number;
  started_at: number | null;
  finished_at: number | null;
  wall_clock_s: number;
  result: unknown;
  error: string | null;
};

export class RunnerError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
  ) {
    super(`job-runner ${status}: ${detail}`);
  }
}

/** Client for the local Python job-runner sidecar (services/job-runner). */
export class RunnerClient {
  constructor(private readonly baseUrl: string) {}

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    const payload = (await res.json().catch(() => ({}))) as { detail?: unknown };
    if (!res.ok) {
      throw new RunnerError(res.status, typeof payload.detail === "string" ? payload.detail : JSON.stringify(payload));
    }
    return payload as T;
  }

  health() {
    return this.request<{ status: string; job_types: Record<string, string> }>("GET", "/health");
  }

  submit(job: { jobId: string; jobType: string; params: Record<string, unknown>; maxRuntimeS: number }) {
    return this.request<RunnerJob>("POST", "/jobs", {
      job_id: job.jobId,
      job_type: job.jobType,
      params: job.params,
      max_runtime_s: job.maxRuntimeS,
    });
  }

  get(jobId: string) {
    return this.request<RunnerJob>("GET", `/jobs/${encodeURIComponent(jobId)}`);
  }

  cancel(jobId: string) {
    return this.request<RunnerJob>("POST", `/jobs/${encodeURIComponent(jobId)}/cancel`);
  }
}
