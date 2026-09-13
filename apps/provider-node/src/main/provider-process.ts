/**
 * Spawns and manages apps/provider/src/index.ts as a child Bun process. It serves the
 * unauthenticated x402-gated job HTTP surface only — it never resolves an identity or signs
 * anything (REGISTRY_TOPIC_ID/BRIDGE_URL are deliberately never set on it), so it needs no Privy
 * credential at all; that's why its env is built explicitly here rather than inherited wholesale
 * from this process's own process.env, which (via env-config.ts's loadRootEnvIntoProcess) now also
 * holds PRIVY_APP_SECRET — no reason for the child to ever see it.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import type { HederaNetwork } from "@decomp/hedera-x402";
import { findRepoRoot, resolveBunPath } from "./bun-runtime";

export type ProviderProcessOptions = {
  providerName: string;
  port: number;
  accountId: string;
  offers: string;
  tokenOffers?: string;
  tickSeconds?: number;
  tickGraceSeconds?: number;
  maxRuntimeS?: number;
  jobRunnerUrl?: string;
  network: HederaNetwork;
  computeTokenId?: string;
};

export type ProviderStatus = { running: boolean; port: number | null };

const INHERITED_ENV_KEYS = ["PATH", "HOME", "USER", "TMPDIR", "LANG"];

let current: { proc: ChildProcess; port: number } | null = null;

export function getProviderStatus(): ProviderStatus {
  return { running: current !== null, port: current?.port ?? null };
}

/** A leftover process from a previous run (an old dev-reload orphan, a test fixture) produces an
 * opaque Bun stack-trace dump if left to Bun's own EADDRINUSE error — checked upfront instead so
 * the UI shows one readable sentence. */
function assertPortFree(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", (error: NodeJS.ErrnoException) => {
      reject(
        error.code === "EADDRINUSE"
          ? new Error(`port ${port} is already in use — stop whatever's using it (an old provider run, a leftover test fixture) and try again`)
          : error,
      );
    });
    probe.once("listening", () => probe.close(() => resolve()));
    probe.listen(port, "127.0.0.1");
  });
}

export async function startProviderProcess(options: ProviderProcessOptions, onLog: (line: string) => void): Promise<void> {
  if (current) throw new Error("the provider is already running — stop it first");
  await assertPortFree(options.port);

  const env: Record<string, string> = {};
  for (const key of INHERITED_ENV_KEYS) if (process.env[key]) env[key] = process.env[key]!;
  Object.assign(env, {
    PROVIDER_NAME: options.providerName,
    PORT: String(options.port),
    PROVIDER_OFFERS: options.offers,
    TICK_SECONDS: String(options.tickSeconds ?? 5),
    TICK_GRACE_SECONDS: String(options.tickGraceSeconds ?? 5),
    MAX_RUNTIME_S: String(options.maxRuntimeS ?? 600),
    JOB_RUNNER_URL: options.jobRunnerUrl ?? "http://127.0.0.1:8100",
    HEDERA_NETWORK: options.network,
    [`${options.providerName}_ACCOUNT_ID`]: options.accountId,
    // Bun auto-loads the repo root's own .env for any child `bun run` process (cwd is the repo
    // root, below) — that .env is exactly where this app's own env-config.ts reads REGISTRY_TOPIC_ID/
    // BRIDGE_URL/PRIVY_APP_SECRET/*_WALLET_ID from for *this* process. Leaving those keys merely
    // absent here does not stop Bun backfilling them from that file, which would make the child
    // attempt its own (REST-signed, embedded-wallet-incompatible) bridge/registry publish — hence
    // explicit blanks, not omission, to actually shadow the .env values.
    REGISTRY_TOPIC_ID: "",
    BRIDGE_URL: "",
    PUBLIC_URL: `http://127.0.0.1:${options.port}`,
    PRIVY_APP_SECRET: "",
    [`${options.providerName}_WALLET_ID`]: "",
  });
  if (options.tokenOffers) env.PROVIDER_TOKEN_OFFERS = options.tokenOffers;
  if (options.computeTokenId) env.COMPUTE_TOKEN_ID = options.computeTokenId;

  const proc = spawn(resolveBunPath(), ["run", "apps/provider/src/index.ts"], { cwd: findRepoRoot(), env });
  current = { proc, port: options.port };

  const relay = (stream: NodeJS.ReadableStream | null) => {
    if (!stream) return;
    let pending = "";
    stream.on("data", (chunk: Buffer) => {
      pending += chunk.toString();
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) onLog(line);
    });
  };
  relay(proc.stdout);
  relay(proc.stderr);
  proc.on("error", error => onLog(`failed to start: ${error.message}`));
  proc.on("exit", code => {
    onLog(`provider process exited with code ${code}`);
    current = null;
  });
}

export function stopProviderProcess(): void {
  current?.proc.kill();
  current = null;
}
