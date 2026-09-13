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
  bridgeUrl: string | null;
  providerName: string;
  runnerPath: string | null;
};

const DEFAULTS: Settings = {
  accountId: null,
  embeddedWalletAddress: null,
  network: "hedera:testnet",
  registryTopicId: null,
  auditTopicId: null,
  computeTokenId: null,
  bridgeUrl: null,
  providerName: "PROVIDER_1",
  runnerPath: null,
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
