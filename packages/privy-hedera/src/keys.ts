/** Turning a Privy wallet into the Hedera public key its account is keyed to. */
import { PublicKey } from "@hiero-ledger/sdk";
import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import type { PrivyClient, PrivyWallet } from "./client";

/** Bytes signed when recovering a wallet's public key; the content doesn't matter, only that it's fixed. */
const RECOVERY_MESSAGE = new TextEncoder().encode("decomp: bind privy wallet to hedera account");

export function evmAddressOf(publicKey: PublicKey): string {
  const uncompressed = secp256k1.ProjectivePoint.fromHex(publicKey.toBytesRaw()).toRawBytes(false);
  return `0x${Buffer.from(keccak_256(uncompressed.subarray(1)).subarray(-20)).toString("hex")}`;
}

/** Parses the hex secp256k1 key Privy reports, compressed or uncompressed, with or without 0x. */
export function parsePrivyPublicKey(publicKey: string): PublicKey {
  const bytes = Buffer.from(publicKey.replace(/^0x/, ""), "hex");
  if (bytes.length !== 33 && bytes.length !== 65) {
    throw new Error(`expected a 33- or 65-byte secp256k1 public key, got ${bytes.length} bytes`);
  }
  const compressed = secp256k1.ProjectivePoint.fromHex(Uint8Array.from(bytes)).toRawBytes(true);
  return PublicKey.fromBytesECDSA(compressed);
}

/**
 * Recovers a wallet's public key by having it sign a fixed message and keeping the candidate that
 * matches the wallet's address. Used when Privy reports no `public_key` for a wallet.
 */
export async function recoverPublicKey(client: PrivyClient, wallet: PrivyWallet): Promise<PublicKey> {
  const digest = keccak_256(RECOVERY_MESSAGE);
  const signature = secp256k1.Signature.fromCompact(await client.signHederaBytes(wallet.id, RECOVERY_MESSAGE));
  for (const recoveryBit of [0, 1]) {
    const candidate = PublicKey.fromBytesECDSA(
      signature.addRecoveryBit(recoveryBit).recoverPublicKey(digest).toRawBytes(true),
    );
    if (evmAddressOf(candidate).toLowerCase() === wallet.address.toLowerCase()) return candidate;
  }
  throw new Error(`could not recover the public key of Privy wallet ${wallet.id} (address ${wallet.address})`);
}

/** The wallet's Hedera public key, from Privy's `public_key` when present, otherwise recovered. */
export async function hederaPublicKeyFor(client: PrivyClient, wallet: PrivyWallet): Promise<PublicKey> {
  if (wallet.public_key) {
    const parsed = parsePrivyPublicKey(wallet.public_key);
    if (evmAddressOf(parsed).toLowerCase() !== wallet.address.toLowerCase()) {
      throw new Error(`Privy wallet ${wallet.id} reports a public key that doesn't match its address`);
    }
    return parsed;
  }
  return recoverPublicKey(client, wallet);
}
