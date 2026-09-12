/**
 * Hedera signing backed by a Privy wallet.
 *
 * Hedera ECDSA signatures are plain secp256k1 over the keccak256 digest of each transaction body,
 * so a Privy wallet can sign Hedera transactions even though Privy has no Hedera chain type. The
 * Hiero SDK asks an async signer for each body (`signWith`), and can run a whole client off one
 * (`setOperatorWith`), so nothing here ever holds a private key.
 */
import { AccountId, Client, Hbar, PublicKey, TokenId, TransactionId, TransferTransaction, type Transaction } from "@hiero-ledger/sdk";
import { HBAR_ASSET, hederaNetwork, type HederaNetwork } from "@decomp/hedera-x402";
import type { PaymentRequirements } from "@x402/core/types";
import type { ClientHederaSigner } from "@x402/hedera";
import type { PrivyClient } from "./client";

/** A Privy wallet bound to the Hedera account it keys. */
export type PrivyHederaWallet = {
  walletId: string;
  accountId: string;
  publicKey: PublicKey;
};

/**
 * Resolves which wallet acts for a role ("AGENT", "PROVIDER_1", …). Configuration-backed today;
 * a future Claude Code connector can implement this against an OAuth subject's Privy user instead,
 * without changing anything downstream.
 */
export type WalletResolver = (role: string) => Promise<PrivyHederaWallet>;

export function createHederaClient(network: HederaNetwork): Client {
  return network === "hedera:mainnet" ? Client.forMainnet() : Client.forTestnet();
}

/** Signs transaction bodies through Privy, for `signWith` and `setOperatorWith`. */
export function createTransactionSigner(privy: PrivyClient, walletId: string) {
  return (message: Uint8Array): Promise<Uint8Array> => privy.signHederaBytes(walletId, message);
}

/**
 * Signs a frozen transaction with the wallet, then checks the signature locally before it goes
 * anywhere, so a bad encoding fails here rather than as an opaque INVALID_SIGNATURE on-chain.
 */
export async function signTransaction<T extends Transaction>(privy: PrivyClient, wallet: PrivyHederaWallet, transaction: T): Promise<T> {
  await transaction.signWith(wallet.publicKey, createTransactionSigner(privy, wallet.walletId));
  if (!wallet.publicKey.verifyTransaction(transaction)) {
    throw new Error(`Privy wallet ${wallet.walletId} produced a signature Hedera rejects for account ${wallet.accountId}`);
  }
  return transaction;
}

/** A Hedera SDK client whose operator signs through Privy: for HCS, HTS, and account setup. */
export function privySdkClient(privy: PrivyClient, wallet: PrivyHederaWallet, network: HederaNetwork = hederaNetwork()): Client {
  return createHederaClient(network).setOperatorWith(
    AccountId.fromString(wallet.accountId),
    wallet.publicKey,
    createTransactionSigner(privy, wallet.walletId),
  );
}

export type PrivySignerOptions = {
  network?: HederaNetwork;
  /**
   * How many consensus nodes the payment transaction is built for. Each one is a separate body and
   * so a separate Privy signature; more nodes means more retries available to the facilitator.
   */
  nodeCount?: number;
};

/**
 * x402 client signer that builds the transfer the facilitator expects and signs it with Privy.
 * Mirrors `createClientHederaSigner` from @x402/hedera, minus the private key.
 */
export function createPrivyClientHederaSigner(
  privy: PrivyClient,
  wallet: PrivyHederaWallet,
  options: PrivySignerOptions = {},
): ClientHederaSigner {
  const network = options.network ?? hederaNetwork();
  const nodeCount = options.nodeCount ?? 2;

  return {
    accountId: wallet.accountId,
    async createPartiallySignedTransferTransaction(requirements: PaymentRequirements): Promise<string> {
      const feePayer = requirements.extra?.feePayer;
      if (typeof feePayer !== "string") {
        throw new Error("feePayer is required in paymentRequirements.extra");
      }
      const amount = BigInt(requirements.amount);
      if (amount <= 0n) {
        throw new Error("amount must be greater than zero");
      }

      const payer = AccountId.fromString(wallet.accountId);
      const payTo = AccountId.fromString(requirements.payTo);
      const transaction = new TransferTransaction();
      if (requirements.asset === HBAR_ASSET) {
        transaction.addHbarTransfer(payer, Hbar.fromTinybars((-amount).toString()));
        transaction.addHbarTransfer(payTo, Hbar.fromTinybars(amount.toString()));
      } else {
        const token = TokenId.fromString(requirements.asset);
        transaction.addTokenTransfer(token, payer, -amount);
        transaction.addTokenTransfer(token, payTo, amount);
      }
      // The facilitator pays the fee, so the transaction id belongs to its account.
      transaction.setTransactionId(TransactionId.generate(AccountId.fromString(feePayer)));

      const client = createHederaClient(network);
      try {
        // Each node gets its own body to sign, so a default freeze would cost seven Privy calls.
        // A couple of nodes keeps a payment to two signatures while leaving the facilitator a retry.
        const nodes = Object.values(client.network)
          .slice(0, Math.max(1, nodeCount))
          .map(node => (typeof node === "string" ? AccountId.fromString(node) : node));
        if (nodes.length > 0) transaction.setNodeAccountIds(nodes);
        transaction.freezeWith(client);
        await signTransaction(privy, wallet, transaction);
        return Buffer.from(transaction.toBytes()).toString("base64");
      } finally {
        client.close();
      }
    },
  };
}
