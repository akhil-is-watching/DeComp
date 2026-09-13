/**
 * A HederaIdentity-shaped signer backed by a Privy *embedded* wallet instead of a server wallet:
 * the actual signing happens in the renderer (see renderer-signer.ts for the Electron-specific
 * transport), and this module only knows about a plain "sign this digest" function — no Electron
 * import here at all, so it's fully unit-testable under `bun test` with a fake one, exactly like
 * packages/privy-hedera/test/privy-hedera.test.ts stubs Privy's REST endpoint.
 *
 * The math mirrors packages/privy-hedera/src/keys.ts and client.ts exactly (keccak256 digest,
 * low-s normalization, public-key recovery — these wallets report no usable public key either),
 * just driven by a client-side raw-hash signer instead of a REST call.
 */
import { AccountId, Client, PublicKey } from "@hiero-ledger/sdk";
import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { evmAddressOf } from "@decomp/privy-hedera";
import { getAccountPublicKey, hederaNetwork, type HederaNetwork } from "@decomp/hedera-x402";

/** Signs a raw digest, returning whatever the wallet gives back (64 or 65 bytes, any s). */
export type RawSigner = (digest: Uint8Array) => Promise<Uint8Array>;

/** Bytes signed when recovering a wallet's public key; only that it's fixed matters. */
const RECOVERY_MESSAGE = new TextEncoder().encode("decomp: bind embedded wallet to hedera account");

/** Hedera rejects high-s signatures and doesn't want a trailing recovery byte. */
export function normalizeSignature(raw: Uint8Array): Uint8Array {
  const compact = raw.length === 65 ? raw.subarray(0, 64) : raw;
  return secp256k1.Signature.fromCompact(compact).normalizeS().toCompactRawBytes();
}

/** Signs arbitrary bytes the way Hedera ECDSA does: secp256k1 over their keccak256 digest. */
export async function signHederaBytes(sign: RawSigner, bytes: Uint8Array): Promise<Uint8Array> {
  return normalizeSignature(await sign(keccak_256(bytes)));
}

/** Recovers the wallet's public key by having it sign a fixed message and keeping the candidate that matches its address. */
export async function recoverPublicKeyFromEmbeddedWallet(sign: RawSigner, address: string): Promise<PublicKey> {
  const digest = keccak_256(RECOVERY_MESSAGE);
  const signature = secp256k1.Signature.fromCompact(await signHederaBytes(sign, RECOVERY_MESSAGE));
  for (const recoveryBit of [0, 1] as const) {
    const candidate = PublicKey.fromBytesECDSA(signature.addRecoveryBit(recoveryBit).recoverPublicKey(digest).toRawBytes(true));
    if (evmAddressOf(candidate).toLowerCase() === address.toLowerCase()) return candidate;
  }
  throw new Error(`could not recover the public key of the embedded wallet at ${address}`);
}

/** Confirms `accountId` is actually keyed to `publicKey` on-chain — the same check apps/provider makes against its env var. */
export async function verifyAccountMatchesKey(accountId: string, publicKey: PublicKey, network?: HederaNetwork): Promise<void> {
  const onChain = await getAccountPublicKey(accountId, network);
  if (!onChain || onChain.toStringRaw() !== publicKey.toStringRaw()) {
    throw new Error(`${accountId} is not keyed to this wallet`);
  }
}

export type EmbeddedWalletIdentity = {
  accountId: string;
  /** Signs arbitrary bytes as this identity — the bridge handshake's one use for this. */
  signMessage: (message: Uint8Array) => Promise<Uint8Array>;
  /** A Hedera client that signs as this identity, for the one-time HCS registration publish. */
  createClient: () => Client;
};

/**
 * Builds the identity a provider uses for its two signing needs (bridge handshake, HCS
 * registration) — never payments, which this project's providers never sign (confirmed by reading
 * apps/provider/src/index.ts: only the agent signs payments). Verifies the user-supplied
 * `accountId` is really keyed to this wallet before returning anything.
 */
export async function createEmbeddedWalletIdentity(
  sign: RawSigner,
  accountId: string,
  address: string,
  network: HederaNetwork = hederaNetwork(),
): Promise<EmbeddedWalletIdentity> {
  const publicKey = await recoverPublicKeyFromEmbeddedWallet(sign, address);
  await verifyAccountMatchesKey(accountId, publicKey, network);
  return {
    accountId,
    signMessage: message => signHederaBytes(sign, message),
    createClient: () => {
      const client = network === "hedera:mainnet" ? Client.forMainnet() : Client.forTestnet();
      return client.setOperatorWith(AccountId.fromString(accountId), publicKey, message => signHederaBytes(sign, message));
    },
  };
}
