/**
 * Minimal client for Privy's wallet REST API.
 *
 * Only the handful of endpoints this project needs, over `fetch`, so no key material and no
 * extra SDK ever enters the process: wallets live in Privy and sign inside its TEE.
 *
 * Signing goes through the wallet RPC method `secp256k1_sign`, which signs a digest along the
 * curve. (The `/raw_sign` endpoint is for other chain types and rejects `ethereum` wallets.)
 */
import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";

export type PrivyConfig = {
  appId: string;
  appSecret: string;
  baseUrl?: string;
  /**
   * Signature over the request, required when a wallet's owner is an authorization key.
   * Wallets this project creates are owned by the app itself, so it is usually unset.
   */
  authorizationSignature?: string;
};

export type PrivyWallet = {
  id: string;
  address: string;
  chain_type: string;
  /** Compressed secp256k1 public key, hex. Absent on some wallets; recover it from a signature instead. */
  public_key?: string | null;
  display_name?: string | null;
  external_id?: string | null;
};

export class PrivyError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`Privy API ${status}: ${body}`);
    this.name = "PrivyError";
  }
}

const DEFAULT_BASE_URL = "https://api.privy.io";

/** Privy returns hex; Hedera wants 64-byte compact r||s with low s, which is what it verifies. */
export function normalizeSignature(hex: string): Uint8Array {
  const bytes = Buffer.from(hex.replace(/^0x/, ""), "hex");
  if (bytes.length !== 64 && bytes.length !== 65) {
    throw new Error(`expected a 64- or 65-byte secp256k1 signature, got ${bytes.length} bytes`);
  }
  // A 65th byte is the recovery id, which Hedera signatures don't carry.
  const compact = Uint8Array.from(bytes.subarray(0, 64));
  return secp256k1.Signature.fromCompact(compact).normalizeS().toCompactRawBytes();
}

export class PrivyClient {
  private readonly baseUrl: string;

  constructor(private readonly config: PrivyConfig) {
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
  }

  private async request<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
    const auth = Buffer.from(`${this.config.appId}:${this.config.appSecret}`).toString("base64");
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Basic ${auth}`,
        "privy-app-id": this.config.appId,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(this.config.authorizationSignature ? { "privy-authorization-signature": this.config.authorizationSignature } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    const text = await res.text();
    if (!res.ok) throw new PrivyError(res.status, text.slice(0, 500));
    return (text ? JSON.parse(text) : {}) as T;
  }

  /**
   * Creates a secp256k1 wallet. Privy has no Hedera chain type, so these are `ethereum` wallets
   * used purely as signers; the Hedera account is created separately from the same public key.
   */
  createWallet(options: { displayName?: string; externalId?: string; idempotencyKey?: string } = {}): Promise<PrivyWallet> {
    return this.request<PrivyWallet>(
      "POST",
      "/v1/wallets",
      {
        chain_type: "ethereum",
        ...(options.displayName ? { display_name: options.displayName } : {}),
        ...(options.externalId ? { external_id: options.externalId } : {}),
      },
      options.idempotencyKey ? { "privy-idempotency-key": options.idempotencyKey } : {},
    );
  }

  getWallet(walletId: string): Promise<PrivyWallet> {
    return this.request<PrivyWallet>("GET", `/v1/wallets/${encodeURIComponent(walletId)}`);
  }

  /** Signs a digest along the secp256k1 curve, with no message prefix of any kind. */
  async signHash(walletId: string, hash: Uint8Array): Promise<Uint8Array> {
    const { data } = await this.request<{ data: { signature: string; encoding?: string } }>(
      "POST",
      `/v1/wallets/${encodeURIComponent(walletId)}/rpc`,
      { method: "secp256k1_sign", params: { hash: `0x${Buffer.from(hash).toString("hex")}` } },
    );
    return normalizeSignature(data.signature);
  }

  /** Signs `bytes` the way Hedera does for ECDSA keys: secp256k1 over their keccak256 digest. */
  signHederaBytes(walletId: string, bytes: Uint8Array): Promise<Uint8Array> {
    return this.signHash(walletId, keccak_256(bytes));
  }
}
