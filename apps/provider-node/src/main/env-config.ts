/**
 * Public config Provider Node can just read from the monorepo's root .env instead of asking for
 * it in Settings — the same file PRIVY_APP_ID already comes from. None of these are secrets:
 * topic/token ids and network are public identifiers, same as the "Live on Hedera testnet" table
 * in the README.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT_ENV_PATH = join(__dirname, "../../../../.env");

function readRootEnv(): Record<string, string> {
  try {
    const text = readFileSync(ROOT_ENV_PATH, "utf8");
    const values: Record<string, string> = {};
    for (const match of text.matchAll(/^([A-Z0-9_]+)=(.*)$/gm)) {
      values[match[1]!] = match[2]!.trim();
    }
    return values;
  } catch {
    return {};
  }
}

export type EnvConfig = {
  network: "hedera:testnet" | "hedera:mainnet";
  registryTopicId: string | null;
  auditTopicId: string | null;
  computeTokenId: string | null;
  /** Tokens a brand-new account is associated with on provisioning (see account-provisioning.ts). */
  associateTokenIds: string[];
};

export function getEnvConfig(): EnvConfig {
  const env = readRootEnv();
  const network = env.HEDERA_NETWORK === "hedera:mainnet" ? "hedera:mainnet" : "hedera:testnet";
  return {
    network,
    registryTopicId: env.REGISTRY_TOPIC_ID || null,
    auditTopicId: env.AUDIT_TOPIC_ID || null,
    computeTokenId: env.COMPUTE_TOKEN_ID || null,
    associateTokenIds: (env.ASSOCIATE_TOKEN_IDS ?? "").split(",").map(s => s.trim()).filter(Boolean),
  };
}

export function getRootEnvValue(key: string): string | undefined {
  return readRootEnv()[key] || undefined;
}

/**
 * Copies the root .env into process.env, the way Bun would automatically for a Bun process —
 * Electron's main process gets none of that. Only needed so provisionUserIdentity's OPERATOR
 * payer (account-provisioning.ts) can authenticate; nothing else in this app reads process.env
 * for anything beyond the public values env-config.ts already exposes on their own. This is the
 * one place PRIVY_APP_SECRET enters this process at all — see account-provisioning.ts's header for
 * why that's an explicit, scoped tradeoff rather than an oversight.
 */
export function loadRootEnvIntoProcess(): void {
  for (const [key, value] of Object.entries(readRootEnv())) {
    if (!(key in process.env)) process.env[key] = value;
  }
}
