/**
 * Locates the `bun` binary used to run apps/provider (a Bun.serve-based server — it can't be
 * `require()`d into this Node.js main process, only spawned as its own process; see
 * provider-process.ts). Dev mode expects Bun already on the machine, same as the rest of this
 * repo; a packaged build bundles its own copy — see scripts/fetch-bun-binary.ts (not built yet).
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

export function resolveBunPath(): string {
  if (process.env.BUN_PATH && existsSync(process.env.BUN_PATH)) return process.env.BUN_PATH;

  const bundled = join(process.resourcesPath ?? "", "bun", "bun");
  if (existsSync(bundled)) return bundled;

  try {
    return execFileSync("which", ["bun"], { encoding: "utf8" }).trim();
  } catch {
    throw new Error("bun was not found on PATH and no bundled copy exists — set BUN_PATH or install Bun");
  }
}

/** The repo root two levels up from apps/provider-node — where `bun run apps/provider/src/index.ts` should run from. */
export function findRepoRoot(): string {
  return join(__dirname, "../../../..");
}
