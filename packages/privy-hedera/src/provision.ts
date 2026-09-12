/**
 * Provisioning a fresh Hedera account for a Privy wallet: create it, fund it, associate tokens.
 * This is the same on-chain work `scripts/setup-privy-wallets.ts` does for the fixed roles, pulled
 * out so a connector can provision one per user too. It takes an already-resolved wallet and a
 * payer client rather than reading env or a role table itself — callers own the "have we already
 * provisioned this user" question (e.g. a connector's own per-user cache).
 */
import { AccountCreateTransaction, Hbar, type Client } from "@hiero-ledger/sdk";
import { associateTokens, type HederaNetwork } from "@decomp/hedera-x402";
import { privySdkClient, type PrivyHederaWallet } from "./signer";
import type { PrivyClient } from "./client";

/** Creates a Hedera account keyed to `wallet`'s public key, funded by `payer`. */
export async function createFundedAccount(payer: Client, wallet: Omit<PrivyHederaWallet, "accountId">, initialHbar: number): Promise<string> {
  const response = await new AccountCreateTransaction()
    .setKeyWithoutAlias(wallet.publicKey)
    .setInitialBalance(new Hbar(initialHbar))
    .execute(payer);
  return (await response.getReceipt(payer)).accountId!.toString();
}

export type ProvisionOptions = {
  /** HBAR the new account is funded with. */
  initialHbar: number;
  /** HTS tokens to associate; the account is brand new, so association always runs (no mirror-node lookup). */
  associateTokenIds?: string[];
  network?: HederaNetwork;
};

/**
 * Creates and funds a Hedera account for `wallet`, then associates it with `associateTokenIds`,
 * returning the wallet with its new `accountId` attached.
 */
export async function provisionUserIdentity(
  privy: PrivyClient,
  wallet: Omit<PrivyHederaWallet, "accountId">,
  payer: Client,
  options: ProvisionOptions,
): Promise<PrivyHederaWallet> {
  const accountId = await createFundedAccount(payer, wallet, options.initialHbar);
  const provisioned: PrivyHederaWallet = { ...wallet, accountId };
  if (options.associateTokenIds?.length) {
    const client = privySdkClient(privy, provisioned, options.network);
    try {
      await associateTokens(client, { accountId }, options.associateTokenIds, { knownUnassociated: true });
    } finally {
      client.close();
    }
  }
  return provisioned;
}
