/**
 * Runs the two processes a node needs to actually sell GPU time, as children of the app:
 *
 *   - the job runner (services/job-runner) — FastAPI on the Apple GPU, refuses to run on CPU
 *   - the provider (apps/provider)         — the x402-gated server that connects out to the bridge
 *
 * Listing a node only advertises an endpoint; until something answers there, agents fail the
 * health check and route elsewhere. This is what makes "go live" mean live.
 *
 * The provider is started with PROVIDER_SIGNER_URL pointing at the app's own loopback signer, so
 * it authenticates to the bridge as *this* node's account without ever holding its key. It is not
 * given a registry topic — the app publishes its own registration, since only the app has a full
 * Hedera identity for the embedded wallet.
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { BrowserWindow } from "electron";
import { fetchRegistry } from "./mirror-reads";
import { startSignerEndpoint, type SignerEndpoint } from "./node-signer";
import type { Settings } from "./settings-store";

export type ProcessName = "runner" | "provider";
export type NodeRunState = {
  running: boolean;
  runner: "stopped" | "starting" | "ready" | "failed";
  provider: "stopped" | "starting" | "ready" | "failed";
  /** Set once the provider reports the bridge handshake succeeded — the node is then reachable. */
  reachableAt: string | null;
  error: string | null;
};

const RUNNER_PORT = 8100;
const PROVIDER_PORT = 4021;
const LOG_LINES = 400;

type Child = { name: ProcessName; process: ChildProcess };

let children: Child[] = [];
let signer: SignerEndpoint | null = null;
let state: NodeRunState = { running: false, runner: "stopped", provider: "stopped", reachableAt: null, error: null };
const log: { name: ProcessName; line: string; at: number }[] = [];
let onChange: (() => void) | null = null;

export function nodeState(): NodeRunState {
  return state;
}

export function nodeLog(): { name: ProcessName; line: string; at: number }[] {
  return log;
}

export function onNodeChange(listener: () => void): void {
  onChange = listener;
}

function update(patch: Partial<NodeRunState>): void {
  state = { ...state, ...patch };
  onChange?.();
}

function record(name: ProcessName, line: string): void {
  for (const part of line.split("\n").map(l => l.trimEnd()).filter(Boolean)) {
    log.push({ name, line: part, at: Date.now() });
    if (log.length > LOG_LINES) log.shift();

    // The provider announces the handshake; that line is the only proof the node is reachable.
    const bridged = part.match(/reachable at (\S+)/);
    if (name === "provider" && bridged) update({ provider: "ready", reachableAt: bridged[1]! });
    if (name === "provider" && part.includes("job runner ok")) update({ runner: "ready" });
    if (name === "runner" && part.includes("Application startup complete")) update({ runner: "ready" });
  }
  onChange?.();
}

/** A checkout root actually has the provider's source next to it — the one thing every layout below shares. */
function isRepoRoot(candidate: string): boolean {
  return existsSync(join(candidate, "apps/provider/src/index.ts"));
}

/**
 * Where the monorepo is, as seen from the app. In development that's four levels up from out/main;
 * a packaged build has no monorepo around it, so the user has to point at a checkout in Settings.
 *
 * The Settings field is labelled "GPU runner checkout path" — reasonably read either as "the path
 * to services/job-runner" (what the placeholder shows) or "the checkout, for the GPU runner" (the
 * repo root itself). Rather than fail a path that's merely pointed one level off from what was
 * intended, try every layout a saved value could plausibly mean.
 */
function repoRoot(runnerPath: string | null): string | null {
  const trimmed = runnerPath?.trim().replace(/\/+$/, "") || null;
  if (trimmed) {
    const candidates = [
      trimmed, // they pointed straight at the repo root
      join(trimmed, ".."), // …/services
      join(trimmed, "..", ".."), // …/services/job-runner (what the placeholder asks for)
    ];
    const found = candidates.find(isRepoRoot);
    if (found) return found;
  }
  const devRoot = join(__dirname, "../../../..");
  return isRepoRoot(devRoot) ? devRoot : null;
}

export type RunnerPathStatus = { ok: boolean; root: string | null; pythonReady: boolean; message: string };

/** What Settings shows next to the field, and what Engine checks before offering Start — same logic startNode uses, so it never disagrees with what actually happens on Start. */
export function checkRunnerPath(runnerPath: string | null): RunnerPathStatus {
  const root = repoRoot(runnerPath);
  if (!root) {
    return {
      ok: false,
      root: null,
      pythonReady: false,
      message: runnerPath ? `no DeComp checkout found at or above "${runnerPath.trim()}"` : "not set — defaulting to this dev checkout, if any",
    };
  }
  const pythonReady = existsSync(join(root, "services/job-runner/.venv/bin/python"));
  return {
    ok: pythonReady,
    root,
    pythonReady,
    message: pythonReady ? `found at ${root}` : `found the checkout at ${root}, but the Python environment for the runner hasn't been created yet`,
  };
}

/** PIDs of whatever is listening on `port`, macOS's `lsof` being the only place to ask. */
function pidsOnPort(port: number): number[] {
  try {
    return execFileSync("lsof", ["-ti", `tcp:${port}`], { encoding: "utf8" })
      .trim()
      .split("\n")
      .filter(Boolean)
      .map(Number);
  } catch {
    return []; // lsof exits non-zero when nothing matches
  }
}

/**
 * A run that ended without stopNode getting to run — the app crashed, was force-quit, or this is a
 * second launch — leaves the runner or provider still bound to their ports. uvicorn then refuses to
 * bind on the next Start ("address already in use") and the whole node fails before it begins.
 * Since these ports are only ever used by processes this app itself spawns, it's safe to just
 * reclaim them: SIGTERM, then SIGKILL anything still holding on after a grace period.
 */
async function freePort(port: number, timeoutMs = 3_000): Promise<void> {
  let pids = pidsOnPort(port);
  if (pids.length === 0) return;
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // already gone
    }
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && pidsOnPort(port).length > 0) {
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  pids = pidsOnPort(port);
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // already gone
    }
  }
}

/**
 * Where a command actually lives. A GUI app inherits a minimal PATH — not the user's login shell —
 * so `bun` installed by nvm, asdf or a custom prefix is invisible to a bare spawn("bun"). Check the
 * usual install locations, then ask the login shell, which is the only thing that knows the rest.
 */
function findBinary(name: string): string | null {
  const home = process.env.HOME ?? "";
  const direct = [join(home, `.bun/bin/${name}`), join(home, `.local/bin/${name}`), `/opt/homebrew/bin/${name}`, `/usr/local/bin/${name}`].find(
    existsSync,
  );
  if (direct) return direct;
  try {
    const found = execFileSync(process.env.SHELL || "/bin/zsh", ["-lc", `command -v ${name}`], { encoding: "utf8", timeout: 5_000 }).trim();
    return found && existsSync(found) ? found : null;
  } catch {
    return null;
  }
}

/**
 * The offers this node actually published, read back from the registry.
 *
 * Without this the provider falls back to its own defaults (benchmark at 0.02 ℏ/s and nothing
 * else), which is not what the listing advertises — so agents cap each payment at the *listed*
 * price, the provider's 402 asks for more, and every job is refused as "no eligible provider".
 * Charging exactly what was advertised is the whole point.
 */
async function listedOffers(settings: Settings): Promise<{ offers: string; tickSeconds: number } | null> {
  if (!settings.registryTopicId || !settings.accountId) return null;
  let registry: Awaited<ReturnType<typeof fetchRegistry>>;
  try {
    registry = await fetchRegistry(settings.registryTopicId, settings.network);
  } catch (error) {
    // Falling back to the defaults here would bring back exactly the bug above: a listed node
    // quietly charging a different price and refusing every job. Better not to start at all.
    throw new Error(
      `couldn't read this node's registry listing, so it can't be sure to charge the listed price — try again ` +
        `(${error instanceof Error ? error.message : String(error)})`,
    );
  }
  const listing = registry.find(entry => entry.hederaAccount === settings.accountId);
  if (!listing || listing.jobTypes.length === 0) {
    // Not listed, so no agent routes here by a registry price; the defaults can't contradict anything.
    record("provider", "no registry listing for this account yet — serving the default offers");
    return null;
  }
  const offers = listing.jobTypes.map(job => `${job.name}:${job.pricePerSecTinybars}`).join(",");
  record("provider", `serving the listed offers: ${offers} (${listing.jobTypes[0]!.tickSeconds}s ticks)`);
  return { offers, tickSeconds: listing.jobTypes[0]!.tickSeconds };
}

export type RunnerSetupResult = { ok: boolean; message: string };

/**
 * Creates the job runner's virtualenv from inside the app.
 *
 * Telling someone who installed a .dmg to open a terminal and run `bun run setup:runner` is not a
 * setup step, it's a dead end — so do it here. uv is what the repo's own script uses and it
 * provisions its own CPython 3.12, which matters because macOS ships 3.9 and mlx/torch need newer.
 */
export async function setupRunner(settings: Settings): Promise<RunnerSetupResult> {
  const root = repoRoot(settings.runnerPath);
  if (!root) return { ok: false, message: "no DeComp checkout found — set the GPU runner path in Settings" };

  const uv = findBinary("uv");
  if (!uv) {
    return {
      ok: false,
      message: "uv isn't installed — install it from astral.sh/uv (it provisions the Python the runner needs), then try again",
    };
  }

  const cwd = join(root, "services/job-runner");
  record("runner", "setting up the Python environment (this downloads Python and PyTorch — give it a few minutes)");
  const steps: string[][] = [
    [uv, "venv", "--python", "3.12", ".venv"],
    [uv, "pip", "install", "--python", ".venv/bin/python", "-r", "requirements.txt"],
  ];

  for (const [command, ...args] of steps) {
    const result = await runToCompletion(command!, args, cwd);
    if (result !== 0) return { ok: false, message: `setup failed while running \`${[command, ...args].join(" ")}\` — see the log above` };
  }
  record("runner", "setup complete — the node can start now");
  return { ok: true, message: "the job runner is set up" };
}

/** Runs one setup command, streaming its output into the same log the Engine tab already shows. */
function runToCompletion(command: string, args: string[], cwd: string): Promise<number> {
  return new Promise(resolve => {
    const child = spawn(command, args, { cwd, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout?.on("data", (chunk: Buffer) => record("runner", chunk.toString()));
    child.stderr?.on("data", (chunk: Buffer) => record("runner", chunk.toString()));
    child.on("error", error => {
      record("runner", `failed to start: ${error.message}`);
      resolve(1);
    });
    child.on("exit", code => resolve(code ?? 1));
  });
}

export async function startNode(win: BrowserWindow, settings: Settings): Promise<void> {
  // A stale run (or a Start clicked while already running) is a restart, not a no-op — stop
  // whatever this app itself is tracking before starting fresh.
  if (state.running) await stopNode("restarting");
  if (!settings.accountId) throw new Error("this node has no Hedera account yet");

  const root = repoRoot(settings.runnerPath);
  if (!root) {
    throw new Error(
      settings.runnerPath
        ? `no DeComp checkout found at or above "${settings.runnerPath}" — it should point at the repo checkout, or its services/job-runner folder`
        : "can't find the DeComp checkout — set the GPU runner path in Settings",
    );
  }

  const python = join(root, "services/job-runner/.venv/bin/python");
  if (!existsSync(python)) {
    throw new Error("the job runner's Python environment hasn't been created yet — use Set up runner on the Engine tab");
  }

  // Bun runs the provider, and a GUI app's PATH won't find it where most people install it.
  const bun = findBinary("bun");
  if (!bun) throw new Error("can't find Bun — install it from bun.sh, then try again");

  // Charge exactly what was advertised; see listedOffers.
  const listed = await listedOffers(settings);

  // Orphaned from a previous run this app instance never tracked — reclaim before spawning fresh
  // children, rather than have uvicorn or Bun.serve fail to bind and take the whole node down.
  await Promise.all([freePort(RUNNER_PORT), freePort(PROVIDER_PORT)]);

  update({ running: true, runner: "starting", provider: "starting", reachableAt: null, error: null });
  signer = await startSignerEndpoint(win);

  spawnChild("runner", python, ["-m", "uvicorn", "app:app", "--host", "127.0.0.1", "--port", String(RUNNER_PORT)], {
    cwd: join(root, "services/job-runner"),
  });

  spawnChild("provider", bun, [join(root, "apps/provider/src/index.ts")], {
    cwd: root,
    env: {
      PROVIDER_NAME: "NODE",
      NODE_ACCOUNT_ID: settings.accountId,
      PROVIDER_SIGNER_URL: signer.url,
      PROVIDER_SIGNER_TOKEN: signer.token,
      JOB_RUNNER_URL: `http://127.0.0.1:${RUNNER_PORT}`,
      PORT: String(PROVIDER_PORT),
      HEDERA_NETWORK: settings.network,
      ...(listed ? { PROVIDER_OFFERS: listed.offers, TICK_SECONDS: String(listed.tickSeconds) } : {}),
      ...(settings.bridgeUrl ? { BRIDGE_URL: settings.bridgeUrl } : {}),
      ...(settings.computeTokenId ? { COMPUTE_TOKEN_ID: settings.computeTokenId } : {}),
      // Deliberately no REGISTRY_TOPIC_ID: the app publishes its own registration.
    },
  });
}

function spawnChild(name: ProcessName, command: string, args: string[], options: { cwd: string; env?: Record<string, string> }): void {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout?.on("data", (chunk: Buffer) => record(name, chunk.toString()));
  child.stderr?.on("data", (chunk: Buffer) => record(name, chunk.toString()));
  child.on("error", error => {
    record(name, `failed to start: ${error.message}`);
    update({ [name]: "failed", error: error.message } as Partial<NodeRunState>);
  });
  child.on("exit", code => {
    record(name, `exited with code ${code ?? 0}`);
    children = children.filter(c => c.name !== name);
    update({ [name]: "stopped" } as Partial<NodeRunState>);
    // One half is useless without the other, so a crash takes the node down rather than leaving
    // a listing pointing at a half-dead process.
    if (state.running) void stopNode(`the ${name} stopped unexpectedly`);
  });

  children.push({ name, process: child });
}

export async function stopNode(reason: string | null = null): Promise<void> {
  const running = children;
  children = [];
  signer?.close();
  signer = null;
  update({ running: false, runner: "stopped", provider: "stopped", reachableAt: null, error: reason });

  for (const { process: child } of running) {
    child.kill("SIGTERM");
  }
  // Anything still alive after a grace period gets SIGKILL, so quitting the app never orphans a
  // provider that keeps answering jobs it can no longer sign for.
  await new Promise(resolve => setTimeout(resolve, 1_500));
  for (const { process: child } of running) {
    if (child.exitCode === null) child.kill("SIGKILL");
  }
}
