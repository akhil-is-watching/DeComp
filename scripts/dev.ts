/**
 * Local network for development and demos: the GPU job runner plus three providers with
 * different job types and prices, each registering on HCS as it boots. Logs from every service
 * stream here with a prefix; Ctrl+C stops everything.
 *
 *   bun run dev
 *   bun run dev -- --skip PROVIDER_2   # leave one out; its old registration makes agents fall back
 *
 * When COMPUTE_TOKEN_ID is set, providers also price their jobs in the compute token.
 */
import type { Subprocess } from "bun";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { ROOT, RUNNER_PYTHON, waitForHealthy } from "./lib/services";

const { values } = parseArgs({ options: { skip: { type: "string", multiple: true, default: [] } } });

const RUNNER_PORT = 8100;
// Tinybars per GPU-second, and compute-token units per second. PROVIDER_3 doesn't offer
// benchmark, so discovery has something to filter out.
const PROVIDERS = [
  { name: "PROVIDER_1", port: 4021, offers: "benchmark:2000000,mandelbrot:5000000", tokenOffers: "benchmark:5,mandelbrot:10" },
  { name: "PROVIDER_2", port: 4022, offers: "benchmark:1600000,mandelbrot:4000000", tokenOffers: "benchmark:4,mandelbrot:8" },
  { name: "PROVIDER_3", port: 4023, offers: "mandelbrot:3000000", tokenOffers: "mandelbrot:6" },
].filter(p => !values.skip.includes(p.name));

const tty = process.stdout.isTTY;
const COLORS = ["\x1b[36m", "\x1b[35m", "\x1b[33m", "\x1b[32m"];
const children: Subprocess[] = [];
let stopping = false;

async function relay(stream: ReadableStream<Uint8Array>, prefix: string) {
  const decoder = new TextDecoder();
  let pending = "";
  for await (const chunk of stream) {
    pending += decoder.decode(chunk, { stream: true });
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) console.log(`${prefix} ${line}`);
  }
  if (pending) console.log(`${prefix} ${pending}`);
}

function start(label: string, cmd: string[], cwd: string, env: Record<string, string>, color: string) {
  const prefix = tty ? `${color}${label.padEnd(10)}\x1b[0m │` : `${label.padEnd(10)} │`;
  const proc = Bun.spawn(cmd, { cwd, env: { ...process.env, ...env }, stdout: "pipe", stderr: "pipe" });
  void relay(proc.stdout, prefix);
  void relay(proc.stderr, prefix);
  void proc.exited.then(code => {
    if (!stopping) console.log(`${prefix} exited with code ${code}`);
  });
  children.push(proc);
}

function stopAll(code: number): never {
  stopping = true;
  for (const child of children) child.kill();
  process.exit(code);
}
process.on("SIGINT", () => stopAll(0));
process.on("SIGTERM", () => stopAll(0));

const busy = [];
for (const p of PROVIDERS) {
  if (await waitForHealthy(`http://127.0.0.1:${p.port}/health`, 500)) busy.push(`${p.name} on :${p.port}`);
}
if (busy.length > 0) {
  console.error(`already running: ${busy.join(", ")}; stop those processes first`);
  process.exit(1);
}

if (await waitForHealthy(`http://127.0.0.1:${RUNNER_PORT}/health`, 500)) {
  console.log(`using the job runner already on :${RUNNER_PORT}`);
} else {
  start(
    "runner",
    [RUNNER_PYTHON, "-m", "uvicorn", "app:app", "--host", "127.0.0.1", "--port", String(RUNNER_PORT)],
    join(ROOT, "services", "job-runner"),
    { PYTHONUNBUFFERED: "1" },
    COLORS[3]!,
  );
  if (!(await waitForHealthy(`http://127.0.0.1:${RUNNER_PORT}/health`, 60_000))) {
    console.error("job runner did not start; run `bun run setup:runner` first");
    stopAll(1);
  }
}

const tokenId = process.env.COMPUTE_TOKEN_ID;
PROVIDERS.forEach((p, i) =>
  start(
    p.name.toLowerCase().replace("_", "-"),
    ["bun", "apps/provider/src/index.ts"],
    ROOT,
    {
      PROVIDER_NAME: p.name,
      PORT: String(p.port),
      PROVIDER_OFFERS: p.offers,
      ...(tokenId ? { PROVIDER_TOKEN_OFFERS: p.tokenOffers } : {}),
    },
    COLORS[i]!,
  ),
);

for (const p of PROVIDERS) {
  if (!(await waitForHealthy(`http://127.0.0.1:${p.port}/health`, 30_000))) {
    console.error(`${p.name} did not become healthy`);
    stopAll(1);
  }
}
console.log(
  `\nready: ${PROVIDERS.map(p => `${p.name} on :${p.port}`).join(", ")}.` +
    `\nIn another terminal: bun run agent -- --job mandelbrot --save out/mandelbrot.png\n`,
);
