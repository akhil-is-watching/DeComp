/** Wiring roles (AGENT, PROVIDER_1, …) to the Privy wallets that sign for them. */
import { PrivyClient, type PrivyConfig } from "./client";
import { hederaPublicKeyFor } from "./keys";
import type { PrivyHederaWallet, WalletResolver } from "./signer";

export function privyConfigFromEnv(env: NodeJS.ProcessEnv = process.env): PrivyConfig {
  const appId = env.PRIVY_APP_ID?.trim();
  const appSecret = env.PRIVY_APP_SECRET?.trim();
  if (!appId || !appSecret) {
    throw new Error("Missing PRIVY_APP_ID / PRIVY_APP_SECRET (see .env.example); create an app at dashboard.privy.io");
  }
  return {
    appId,
    appSecret,
    ...(env.PRIVY_API_URL ? { baseUrl: env.PRIVY_API_URL } : {}),
    ...(env.PRIVY_AUTHORIZATION_SIGNATURE ? { authorizationSignature: env.PRIVY_AUTHORIZATION_SIGNATURE } : {}),
  };
}

export function privyClientFromEnv(env: NodeJS.ProcessEnv = process.env): PrivyClient {
  return new PrivyClient(privyConfigFromEnv(env));
}

/** Looks up the wallet and Hedera account a role signs with, from `<ROLE>_WALLET_ID` and `<ROLE>_ACCOUNT_ID`. */
export async function walletFromEnv(
  privy: PrivyClient,
  role: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<PrivyHederaWallet> {
  const walletId = env[`${role}_WALLET_ID`]?.trim();
  const accountId = env[`${role}_ACCOUNT_ID`]?.trim();
  if (!walletId || !accountId) {
    throw new Error(`Missing ${role}_WALLET_ID / ${role}_ACCOUNT_ID — run \`bun run setup:privy\``);
  }
  const wallet = await privy.getWallet(walletId);
  return { walletId, accountId, publicKey: await hederaPublicKeyFor(privy, wallet) };
}

/**
 * Config-backed resolver, with each role looked up once per process. A connector that
 * authenticates users over OAuth can swap in its own resolver without touching callers.
 */
export function envWalletResolver(privy: PrivyClient, env: NodeJS.ProcessEnv = process.env): WalletResolver {
  const cache = new Map<string, Promise<PrivyHederaWallet>>();
  return role => {
    const cached = cache.get(role) ?? walletFromEnv(privy, role, env);
    cache.set(role, cached);
    return cached;
  };
}
