/**
 * Real integration test: a locally generated key stands in for an embedded wallet (same pattern as
 * embedded-wallet-identity.test.ts), and provisionAccountForSigner runs its actual code path
 * against real testnet infrastructure — a real OPERATOR-funded account creation, then a real token
 * association signed through the *new* account's own client (not Privy's REST API — the bug this
 * test exists to pin down: an embedded wallet has no Privy wallet id to sign through that way).
 */
import { describe, expect, test } from "bun:test";
import { PrivateKey } from "@hiero-ledger/sdk";
import { secp256k1 } from "@noble/curves/secp256k1";
import { evmAddressOf } from "@decomp/privy-hedera";
import { getTokenBalance } from "@decomp/hedera-x402";
import { provisionAccountForSigner } from "../src/main/account-provisioning";
import type { RawSigner } from "../src/main/identity/embedded-wallet-identity";

function stubWallet() {
  const key = PrivateKey.generateECDSA();
  const raw = key.toBytesRaw();
  const address = evmAddressOf(key.publicKey);
  const sign: RawSigner = async digest => Uint8Array.from(secp256k1.sign(digest, raw).toCompactRawBytes());
  return { address, sign };
}

describe("provisionAccountForSigner", () => {
  test("creates a funded account and associates it, signed by the account itself", async () => {
    const { address, sign } = stubWallet();
    const { accountId } = await provisionAccountForSigner(sign, address, ["0.0.429274"]);
    expect(accountId).toMatch(/^0\.0\.\d+$/);

    // getTokenBalance returns null for an unassociated account; a real balance (0 here) confirms
    // it worked. The mirror node lags consensus by a few seconds, so retry rather than assume.
    let balance: bigint | null = null;
    for (let attempt = 0; attempt < 6 && balance === null; attempt++) {
      balance = await getTokenBalance(accountId, "0.0.429274");
      if (balance === null) await new Promise(resolve => setTimeout(resolve, 1_500));
    }
    expect(balance).toBe(0n);
  }, 30_000);

  test("skips association when no tokens are requested", async () => {
    const { address, sign } = stubWallet();
    const { accountId } = await provisionAccountForSigner(sign, address, []);
    expect(accountId).toMatch(/^0\.0\.\d+$/);
  }, 15_000);
});
