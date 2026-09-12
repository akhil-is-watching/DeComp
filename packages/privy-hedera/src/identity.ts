/**
 * The identity an app acts as: a Privy wallet bound to a Hedera account.
 *
 * Agents, providers, and scripts take a HederaIdentity rather than a key, so the only thing that
 * has to change for a Claude Code connector is where the identity comes from: resolve the caller's
 * Privy user from their OAuth session and build the same object.
 */
import type { Client } from "@hiero-ledger/sdk";
import { hederaNetwork, type HederaNetwork } from "@decomp/hedera-x402";
import type { ClientHederaSigner } from "@x402/hedera";
import type { PrivyClient } from "./client";
import { createPrivyClientHederaSigner, privySdkClient, type PrivyHederaWallet } from "./signer";
import { privyClientFromEnv, walletFromEnv } from "./wallets";

export type HederaIdentity = {
  role: string;
  accountId: string;
  wallet: PrivyHederaWallet;
  /** Signs x402 payments; every signature happens inside Privy. */
  paymentSigner: ClientHederaSigner;
  /** A Hedera client that signs as this identity, for HCS, HTS, and account work. Close it when done. */
  createClient: () => Client;
};

export type PrivyIdentityOptions = {
  privy?: PrivyClient;
  network?: HederaNetwork;
  env?: NodeJS.ProcessEnv;
  nodeCount?: number;
};

/** Builds the identity for a role from `<ROLE>_WALLET_ID` and `<ROLE>_ACCOUNT_ID`. */
export async function privyIdentity(role: string, options: PrivyIdentityOptions = {}): Promise<HederaIdentity> {
  const env = options.env ?? process.env;
  const privy = options.privy ?? privyClientFromEnv(env);
  const network = options.network ?? hederaNetwork();
  const wallet = await walletFromEnv(privy, role, env);
  return {
    role,
    accountId: wallet.accountId,
    wallet,
    paymentSigner: createPrivyClientHederaSigner(privy, wallet, {
      network,
      ...(options.nodeCount === undefined ? {} : { nodeCount: options.nodeCount }),
    }),
    createClient: () => privySdkClient(privy, wallet, network),
  };
}
