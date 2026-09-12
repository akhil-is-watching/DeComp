/** Connector configuration, read once at startup. */
import { requireEnv } from "@decomp/hedera-x402";

/** A PEM key can't hold a literal newline in .env; store it with `\n` escapes and unescape here. */
function requirePem(name: string): string {
  return requireEnv(name).replace(/\\n/g, "\n");
}

export const env = {
  port: Number(process.env.CONNECTOR_PORT ?? 4030),
  // The public origin Claude and the login page redirect back to; override with a tunnel URL
  // (e.g. ngrok) when testing against claude.ai, since it can't reach 127.0.0.1.
  baseUrl: (process.env.CONNECTOR_BASE_URL ?? `http://127.0.0.1:${process.env.CONNECTOR_PORT ?? 4030}`).replace(/\/$/, ""),
  dbPath: process.env.CONNECTOR_DB_PATH ?? new URL("../data/connector.sqlite", import.meta.url).pathname,

  privyAppId: requireEnv("PRIVY_APP_ID"),
  get privyVerificationKey(): string {
    return requirePem("PRIVY_VERIFICATION_KEY");
  },
  get tokenSecret(): string {
    return requireEnv("CONNECTOR_TOKEN_SECRET");
  },

  userInitialHbar: Number(process.env.CONNECTOR_USER_INITIAL_HBAR ?? 5),
  maxBudgetHbar: Number(process.env.CONNECTOR_MAX_BUDGET_HBAR ?? 1),

  registryTopicId: process.env.REGISTRY_TOPIC_ID || undefined,
  auditTopicId: process.env.AUDIT_TOPIC_ID || undefined,
  computeTokenId: process.env.COMPUTE_TOKEN_ID || undefined,
  associateTokenIds: (process.env.ASSOCIATE_TOKEN_IDS ?? "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean),
};
