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
import { createPrivyClientHederaSigner, createTransactionSigner, privySdkClient, type PrivyHederaWallet } from "./signer";
import { privyClientFromEnv, walletFromEnv } from "./wallets";

/** The wiring shared by `privyIdentity` and `identityForUser`, once a wallet is in hand. */
function buildIdentity(role: string, privy: PrivyClient, wallet: PrivyHederaWallet, network: HederaNetwork, nodeCount?: number): HederaIdentity {
  return {
    role,
    accountId: wallet.accountId,
    wallet,
    paymentSigner: createPrivyClientHederaSigner(privy, wallet, { network, ...(nodeCount === undefined ? {} : { nodeCount }) }),
    signMessage: createTransactionSigner(privy, wallet.walletId),
    createClient: () => privySdkClient(privy, wallet, network),
  };
}

export type HederaIdentity = {
  role: string;
  accountId: string;
  wallet: PrivyHederaWallet;
  /** Signs x402 payments; every signature happens inside Privy. */
  paymentSigner: ClientHederaSigner;
  /**
   * Signs arbitrary bytes as this identity (secp256k1 over their keccak256 digest — the same
   * scheme Hedera ECDSA transactions use, verifiable with `PublicKey.verify`). Used for proving
   * control of the account outside of a Hedera transaction, e.g. the bridge's connect handshake.
   */
  signMessage: (message: Uint8Array) => Promise<Uint8Array>;
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
  return buildIdentity(role, privy, wallet, network, options.nodeCount);
}

/**
 * Builds the identity for an arbitrary user key (e.g. a Privy DID) from an already-resolved
 * wallet. A user's wallet can't be looked up from the key alone the way a role's can from env —
 * there's no bounded env table for an open set of users — so callers resolve and cache it
 * themselves (see `walletForUser` and `provisionUserIdentity`) and pass it in here. This is the
 * seam the header comment above describes: everything else about `HederaIdentity` stays the same.
 */
export async function identityForUser(userKey: string, wallet: PrivyHederaWallet, options: PrivyIdentityOptions = {}): Promise<HederaIdentity> {
  const privy = options.privy ?? privyClientFromEnv(options.env ?? process.env);
  const network = options.network ?? hederaNetwork();
  return buildIdentity(`USER:${userKey}`, privy, wallet, network, options.nodeCount);
}
