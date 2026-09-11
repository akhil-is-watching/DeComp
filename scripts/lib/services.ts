import { mkdirSync, openSync } from "node:fs";
import { join } from "node:path";
import type { Subprocess } from "bun";

export const ROOT = join(import.meta.dir, "..", "..");
export const RUNNER_PYTHON = join(ROOT, "services", "job-runner", ".venv", "bin", "python");

export type ServiceSpec = {
  name: string;
  healthUrl: string;
  cmd: string[];
  cwd: string;
  env?: Record<string, string>;
};

export async function waitForHealthy(url: string, timeoutMs = 30_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(2_000) })).ok) return true;
    } catch {
      // not up yet
    }
    await Bun.sleep(300);
  }
  return false;
}

export function runnerService(port = 8100): ServiceSpec {
  return {
    name: "job-runner",
    healthUrl: `http://127.0.0.1:${port}/health`,
    cmd: [RUNNER_PYTHON, "-m", "uvicorn", "app:app", "--host", "127.0.0.1", "--port", String(port)],
    cwd: join(ROOT, "services", "job-runner"),
  };
}

export function providerService(name: string, port: number, env: Record<string, string> = {}): ServiceSpec {
  return {
    name: name.toLowerCase().replace("_", "-"),
    healthUrl: `http://127.0.0.1:${port}/health`,
    cmd: ["bun", "apps/provider/src/index.ts"],
    cwd: ROOT,
    env: { PROVIDER_NAME: name, PORT: String(port), ...env },
  };
}

/**
 * Starts each service whose health check fails, in order, logging to logs/<name>.log.
 * Returns a function that stops only the processes this call started.
 */
export async function ensureServices(specs: ServiceSpec[]): Promise<{ stop: () => void; started: Map<string, Subprocess> }> {
  const logDir = join(ROOT, "logs");
  mkdirSync(logDir, { recursive: true });
  const started = new Map<string, Subprocess>();
  const stop = () => {
    for (const proc of started.values()) proc.kill();
  };

  try {
    for (const spec of specs) {
      if (await waitForHealthy(spec.healthUrl, 1_000)) {
        console.log(`using already-running ${spec.name}`);
        continue;
      }
      const fd = openSync(join(logDir, `${spec.name}.log`), "w");
      started.set(
        spec.name,
        Bun.spawn(spec.cmd, { cwd: spec.cwd, env: { ...process.env, ...spec.env }, stdout: fd, stderr: fd }),
      );
      if (!(await waitForHealthy(spec.healthUrl, 60_000))) {
        throw new Error(`${spec.name} did not become healthy — see logs/${spec.name}.log`);
      }
      console.log(`started ${spec.name} (logs/${spec.name}.log)`);
    }
  } catch (error) {
    stop();
    throw error;
  }
  process.once("SIGINT", () => {
    stop();
    process.exit(130);
  });
  return { stop, started };
}
