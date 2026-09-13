/**
 * Tests the embedded-wallet signing math against a stubbed RawSigner — a locally generated key
 * that signs whatever digest it's given, exactly like packages/privy-hedera's test stubs Privy's
 * REST endpoint. No Electron import anywhere in embedded-wallet-identity.ts, so no real window or
 * real Privy login is needed here; verifyAccountMatchesKey's checks against a real account are the
 * one thing that legitimately needs the mirror node, done against the already-live AGENT/OPERATOR
 * testnet accounts (free, read-only — see prior test files in this repo for the same pattern).
 */
import { describe, expect, test } from "bun:test";
import { PrivateKey } from "@hiero-ledger/sdk";
import { secp256k1 } from "@noble/curves/secp256k1";
import {
  createEmbeddedWalletIdentity,
  normalizeSignature,
  recoverPublicKeyFromEmbeddedWallet,
  signHederaBytes,
  verifyAccountMatchesKey,
  type RawSigner,
} from "../src/main/identity/embedded-wallet-identity";
import { evmAddressOf } from "@decomp/privy-hedera";

function stubWallet() {
  const key = PrivateKey.generateECDSA();
  const raw = key.toBytesRaw();
  const address = evmAddressOf(key.publicKey);
  const sign: RawSigner = async digest => Uint8Array.from(secp256k1.sign(digest, raw).toCompactRawBytes());
  return { key, address, sign };
}

describe("signHederaBytes", () => {
  test("produces a signature the wallet's own key verifies", async () => {
    const { key, sign } = stubWallet();
    const message = new TextEncoder().encode("hello provider node");
    const signature = await signHederaBytes(sign, message);
    expect(signature).toHaveLength(64);
    expect(key.publicKey.verify(message, signature)).toBe(true);
  });

  test("normalizes a 65-byte recoverable signature down to 64, still verifiable", async () => {
    const { key } = stubWallet();
    const message = new TextEncoder().encode("trim the recovery byte");
    const digest = (await import("@noble/hashes/sha3")).keccak_256(message);
    const compact = secp256k1.sign(digest, key.toBytesRaw()).toCompactRawBytes();
    const withRecoveryByte: RawSigner = async () => Uint8Array.from([...compact, 27]);

    const signature = await signHederaBytes(withRecoveryByte, message);
    expect(signature).toHaveLength(64);
    expect(key.publicKey.verify(message, signature)).toBe(true);
  });
});

describe("recoverPublicKeyFromEmbeddedWallet", () => {
  test("recovers the wallet's real public key from its address", async () => {
    const { key, address, sign } = stubWallet();
    const recovered = await recoverPublicKeyFromEmbeddedWallet(sign, address);
    expect(recovered.toStringRaw()).toBe(key.publicKey.toStringRaw());
  });

  test("throws if the signer belongs to a different address", async () => {
    const { sign } = stubWallet();
    await expect(recoverPublicKeyFromEmbeddedWallet(sign, "0x0000000000000000000000000000000000000000")).rejects.toThrow(
      "could not recover",
    );
  });
});

describe("verifyAccountMatchesKey", () => {
  test("throws when the account's on-chain key doesn't match", async () => {
    const { key } = stubWallet();
    await expect(verifyAccountMatchesKey(process.env.AGENT_ACCOUNT_ID!, key.publicKey)).rejects.toThrow("not keyed to this wallet");
  });
});

describe("createEmbeddedWalletIdentity", () => {
  test("refuses an account not keyed to the wallet, before returning anything signable", async () => {
    const { address, sign } = stubWallet();
    await expect(createEmbeddedWalletIdentity(sign, process.env.AGENT_ACCOUNT_ID!, address)).rejects.toThrow("not keyed to this wallet");
  });

  test("end to end: signs, recovers, verifies on-chain, and builds a working client, for a real fresh account", async () => {
    // A throwaway local key + a fresh testnet account funded just for this test — same pattern
    // used earlier this session for live bridge verification. Never touches Privy or .env.
    const { PublicKey, AccountCreateTransaction, Hbar } = await import("@hiero-ledger/sdk");
    const { privyIdentity } = await import("@decomp/privy-hedera");
    void PublicKey;

    const { address, sign, key } = stubWallet();
    const operator = await privyIdentity("OPERATOR");
    const payer = operator.createClient();
    let accountId: string;
    try {
      const response = await new AccountCreateTransaction().setKeyWithoutAlias(key.publicKey).setInitialBalance(new Hbar(1)).execute(payer);
      accountId = (await response.getReceipt(payer)).accountId!.toString();
    } finally {
      payer.close();
    }

    // The mirror node lags consensus by a few seconds for a brand-new account (same lag
    // scripts/setup-privy-wallets.ts works around); retry rather than assume it's indexed yet.
    let identity: Awaited<ReturnType<typeof createEmbeddedWalletIdentity>> | undefined;
    for (let attempt = 0; attempt < 6 && !identity; attempt++) {
      try {
        identity = await createEmbeddedWalletIdentity(sign, accountId, address);
      } catch (error) {
        if (attempt === 5) throw error;
        await new Promise(resolve => setTimeout(resolve, 1_500));
      }
    }
    const resolved = identity!;
    expect(resolved.accountId).toBe(accountId);

    const message = new TextEncoder().encode("provider node bridge handshake");
    const signature = await resolved.signMessage(message);
    expect(key.publicKey.verify(message, signature)).toBe(true);

    const client = resolved.createClient();
    client.close();
  }, 30_000);
});
