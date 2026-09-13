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
  /** What agents see this node listed as. The one thing onboarding asks for. */
  providerName: string;
  runnerPath: string | null;
  /** Set when the user finishes onboarding; null means they never have. */
  onboardedAt: string | null;
  /** Last window frame, so the app reopens where it was left (see window-state.ts). */
  windowBounds: { x: number; y: number; width: number; height: number } | null;
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
  // Empty, not "PROVIDER_1" — that was a fixed demo-role name, never a sensible default for a
  // person. Onboarding asks for a real one before the dashboard opens.
  providerName: "",
  runnerPath: null,
  onboardedAt: null,
  windowBounds: null,
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
