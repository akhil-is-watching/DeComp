/** Provider Node's own local config — a JSON file under the OS's per-app data directory. */
import { app } from "electron";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type Settings = {
  accountId: string | null;
  embeddedWalletAddress: string | null;
  network: "hedera:testnet" | "hedera:mainnet";
  registryTopicId: string | null;
  auditTopicId: string | null;
  computeTokenId: string | null;
  /** Tokens a brand-new account gets associated with on provisioning (see account-provisioning.ts). */
  associateTokenIds: string[];
  bridgeUrl: string | null;
  providerName: string;
  runnerPath: string | null;
  port: number;
  offersSpec: string;
  tickSeconds: number;
  tickGraceSeconds: number;
  maxRuntimeS: number;
  jobRunnerUrl: string;
};

const DEFAULTS: Settings = {
  accountId: null,
  embeddedWalletAddress: null,
  network: "hedera:testnet",
  registryTopicId: null,
  auditTopicId: null,
  computeTokenId: null,
  associateTokenIds: [],
  bridgeUrl: "https://bridge.decomp.cloud",
  providerName: "PROVIDER_1",
  runnerPath: null,
  port: 4021,
  offersSpec: "benchmark:2000000",
  tickSeconds: 5,
  tickGraceSeconds: 5,
  maxRuntimeS: 600,
  jobRunnerUrl: "http://127.0.0.1:8100",
};

function settingsPath(): string {
  return join(app.getPath("userData"), "settings.json");
}

export function loadSettings(): Settings {
  try {
    const raw = readFileSync(settingsPath(), "utf8");
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const merged = { ...loadSettings(), ...patch };
  mkdirSync(app.getPath("userData"), { recursive: true });
  writeFileSync(settingsPath(), JSON.stringify(merged, null, 2));
  return merged;
}

export function settingsFileExists(): boolean {
  return existsSync(settingsPath());
}
