/** Connector configuration, read once at startup. */
import { requireEnv } from "@decomp/hedera-x402";

export const env = {
  port: Number(process.env.CONNECTOR_PORT ?? 4030),
  // The public origin Claude and the login page redirect back to; override with a tunnel URL
  // (e.g. ngrok) when testing against claude.ai, since it can't reach 127.0.0.1.
  baseUrl: (process.env.CONNECTOR_BASE_URL ?? `http://127.0.0.1:${process.env.CONNECTOR_PORT ?? 4030}`).replace(/\/$/, ""),
  dbPath: process.env.CONNECTOR_DB_PATH ?? new URL("../data/connector.sqlite", import.meta.url).pathname,

  privyAppId: requireEnv("PRIVY_APP_ID"),
  // The app's JWKS endpoint, for verifying its access tokens — derived from the app id, since
  // that's Privy's fixed URL shape (dashboard → App settings → Basics → JWKS Endpoint). Overridable
  // for tests, or if Privy ever changes the shape before this key rotates.
  get privyJwksUrl(): string {
    return process.env.PRIVY_JWKS_URL || `https://auth.privy.io/api/v1/apps/${this.privyAppId}/jwks.json`;
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
