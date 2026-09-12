/** Verifying a provider's connect-time proof that it controls the Hedera account it claims. */
import { getAccountPublicKey, type HederaNetwork } from "@decomp/hedera-x402";
import type { HelloFrame } from "./types";

export function randomNonce(bytes = 32): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString("base64");
}

export type HelloCheck = { ok: true } | { ok: false; reason: string };

/**
 * `hello.signature` must be `accountId`'s signature (secp256k1 over keccak256, the scheme every
 * identity in this project already signs with — see HederaIdentity.signMessage) over `nonce`'s raw
 * bytes, verified against what the mirror node actually reports for that account's key. This ties
 * a bridge connection to real control of the account, not just a claim.
 */
export async function verifyHello(hello: HelloFrame, nonce: string, network?: HederaNetwork): Promise<HelloCheck> {
  let key;
  try {
    key = await getAccountPublicKey(hello.accountId, network);
  } catch {
    return { ok: false, reason: `could not look up ${hello.accountId} on the mirror node` };
  }
  if (!key) return { ok: false, reason: `${hello.accountId} has no ECDSA key on-chain` };

  let signature: Buffer;
  try {
    signature = Buffer.from(hello.signature, "base64");
  } catch {
    return { ok: false, reason: "signature is not valid base64" };
  }
  if (signature.length !== 64) return { ok: false, reason: "signature must be a 64-byte compact secp256k1 signature" };

  // A malformed signature (e.g. r=s=0) can throw inside the SDK's verify rather than return
  // false; this is otherwise-untrusted input from anyone who can open a connection, so it must
  // never crash or hang the caller.
  let verified: boolean;
  try {
    verified = key.verify(new Uint8Array(Buffer.from(nonce, "base64")), new Uint8Array(signature));
  } catch {
    return { ok: false, reason: "signature is malformed" };
  }
  return verified ? { ok: true } : { ok: false, reason: `signature does not match ${hello.accountId}'s on-chain key` };
}
