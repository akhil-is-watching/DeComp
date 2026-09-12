/**
 * Tests the Privy-backed Hedera signer against a stubbed Privy API, so they need no credentials.
 * The stub holds a local ECDSA key and signs the digest it is given, as `secp256k1_sign` does.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { PrivateKey, Transaction, TransferTransaction } from "@hiero-ledger/sdk";
import type { PaymentRequirements } from "@x402/core/types";
import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { PrivyClient, PrivyError, normalizeSignature } from "../src/client";
import { evmAddressOf, hederaPublicKeyFor, parsePrivyPublicKey } from "../src/keys";
import { identityForUser } from "../src/identity";
import { createPrivyClientHederaSigner, type PrivyHederaWallet } from "../src/signer";
import { walletForUser } from "../src/wallets";

const walletKey = PrivateKey.generateECDSA();
const walletKeyRaw = walletKey.toBytesRaw();
const otherKey = PrivateKey.generateECDSA();
const address = evmAddressOf(walletKey.publicKey);

type Mode = "compact" | "recoverable" | "highS" | "wrongKey";
type StubBody = { method?: string; params?: { hash?: string } };
type StubRequest = { path: string; method: string; authorization: string | null; appId: string | null; body?: StubBody };

let mode: Mode = "compact";
let reportPublicKey = true;
let requests: StubRequest[] = [];

function stubSign(digest: Uint8Array): string {
  const raw = mode === "wrongKey" ? otherKey.toBytesRaw() : walletKeyRaw;
  const signed = secp256k1.sign(digest, raw);
  const signature = mode === "highS" ? new secp256k1.Signature(signed.r, secp256k1.CURVE.n - signed.s) : signed;
  const compact = Buffer.from(signature.toCompactRawBytes());
  const bytes = mode === "recoverable" ? Buffer.concat([compact, Buffer.from([28])]) : compact;
  return `0x${bytes.toString("hex")}`;
}

let server: ReturnType<typeof Bun.serve>;
beforeAll(() => {
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const body = req.method === "POST" ? ((await req.json()) as StubBody) : undefined;
      requests.push({
        path: url.pathname,
        method: req.method,
        authorization: req.headers.get("authorization"),
        appId: req.headers.get("privy-app-id"),
        body,
      });

      const wallet = {
        id: "wal_1",
        address,
        chain_type: "ethereum",
        public_key: reportPublicKey ? `0x${Buffer.from(secp256k1.getPublicKey(walletKeyRaw, true)).toString("hex")}` : null,
      };
      if (url.pathname === "/v1/wallets" && req.method === "POST") return Response.json(wallet);
      if (url.pathname === "/v1/wallets/wal_1" && req.method === "GET") return Response.json(wallet);
      if (url.pathname === "/v1/wallets/wal_1/rpc" && body?.method === "secp256k1_sign" && body.params?.hash) {
        const digest = Uint8Array.from(Buffer.from(body.params.hash.replace(/^0x/, ""), "hex"));
        return Response.json({ method: "secp256k1_sign", data: { signature: stubSign(digest), encoding: "hex" } });
      }
      return new Response("wallet not found", { status: 404 });
    },
  });
});
afterAll(() => server.stop(true));
beforeEach(() => {
  mode = "compact";
  reportPublicKey = true;
  requests = [];
});

const privy = () => new PrivyClient({ appId: "app-id", appSecret: "app-secret", baseUrl: `http://127.0.0.1:${server.port}` });
const wallet = (): PrivyHederaWallet => ({ walletId: "wal_1", accountId: "0.0.1001", publicKey: walletKey.publicKey });
const signRequests = () => requests.filter(r => r.path.endsWith("/rpc"));

const requirements = (overrides: Partial<PaymentRequirements> = {}): PaymentRequirements =>
  ({
    scheme: "exact",
    network: "hedera:testnet",
    asset: "0.0.0",
    amount: "15000000",
    payTo: "0.0.1002",
    maxTimeoutSeconds: 120,
    extra: { feePayer: "0.0.7162784" },
    ...overrides,
  }) as PaymentRequirements;

describe("PrivyClient", () => {
  test("authenticates with basic auth and the app id header", async () => {
    await privy().getWallet("wal_1");
    expect(requests[0]!.authorization).toBe(`Basic ${Buffer.from("app-id:app-secret").toString("base64")}`);
    expect(requests[0]!.appId).toBe("app-id");
  });

  test("hashes Hedera bytes with keccak256 and signs the digest through secp256k1_sign", async () => {
    const message = new TextEncoder().encode("hedera body bytes");
    const signature = await privy().signHederaBytes("wal_1", message);
    const sent = signRequests().at(-1)!.body!;
    expect(sent.method).toBe("secp256k1_sign");
    expect(sent.params!.hash).toBe(`0x${Buffer.from(keccak_256(message)).toString("hex")}`);
    expect(walletKey.publicKey.verify(message, signature)).toBe(true);
  });

  test.each([
    ["a 65-byte recoverable signature", "recoverable" as Mode],
    ["a high-s signature Hedera would reject", "highS" as Mode],
  ])("normalizes %s", async (_, signatureMode) => {
    mode = signatureMode;
    const message = new TextEncoder().encode("hedera body bytes");
    const signature = await privy().signHederaBytes("wal_1", message);
    expect(signature).toHaveLength(64);
    expect(walletKey.publicKey.verify(message, signature)).toBe(true);
  });

  test("rejects signatures of the wrong length", () => {
    expect(() => normalizeSignature("0xdeadbeef")).toThrow("64- or 65-byte");
  });

  test("surfaces API failures with their status", async () => {
    const error = await privy().getWallet("missing").catch(e => e);
    expect(error).toBeInstanceOf(PrivyError);
    expect((error as PrivyError).status).toBe(404);
  });
});

describe("public keys", () => {
  test("reads the compressed key Privy reports", async () => {
    const client = privy();
    const key = await hederaPublicKeyFor(client, await client.getWallet("wal_1"));
    expect(key.toStringRaw()).toBe(walletKey.publicKey.toStringRaw());
  });

  test("accepts compressed and uncompressed hex alike", () => {
    const uncompressed = Buffer.from(secp256k1.getPublicKey(walletKeyRaw, false)).toString("hex");
    expect(parsePrivyPublicKey(`0x${uncompressed}`).toStringRaw()).toBe(walletKey.publicKey.toStringRaw());
  });

  test("recovers the key from a signature when Privy reports none", async () => {
    reportPublicKey = false;
    const client = privy();
    const key = await hederaPublicKeyFor(client, await client.getWallet("wal_1"));
    expect(key.toStringRaw()).toBe(walletKey.publicKey.toStringRaw());
  });
});

describe("HederaIdentity.signMessage", () => {
  test("signs arbitrary bytes verifiably against the wallet's public key", async () => {
    const identity = await identityForUser("test-user", wallet(), { privy: privy(), network: "hedera:testnet" });
    const message = new TextEncoder().encode("prove you hold this account");
    const signature = await identity.signMessage(message);
    expect(walletKey.publicKey.verify(message, signature)).toBe(true);
    expect(walletKey.publicKey.verify(new TextEncoder().encode("a different message"), signature)).toBe(false);
  });
});

describe("walletForUser", () => {
  test("sanitizes a Privy DID's colons out of external_id", async () => {
    await walletForUser(privy(), "did:privy:cm123abc");
    const created = requests.find(r => r.path === "/v1/wallets" && r.method === "POST")!;
    const externalId = (created.body as unknown as { external_id?: string }).external_id;
    expect(externalId).toBe("connector-user-did-privy-cm123abc");
    expect(externalId).not.toContain(":");
  });

  test("caps external_id at 64 characters for very long keys", async () => {
    await walletForUser(privy(), "x".repeat(100));
    const created = requests.find(r => r.path === "/v1/wallets" && r.method === "POST")!;
    const externalId = (created.body as unknown as { external_id?: string }).external_id!;
    expect(externalId.length).toBeLessThanOrEqual(64);
  });
});

describe("x402 payment signing", () => {
  test("signs a transfer the facilitator can verify", async () => {
    const signer = createPrivyClientHederaSigner(privy(), wallet());
    const encoded = await signer.createPartiallySignedTransferTransaction(requirements());

    const transaction = Transaction.fromBytes(Buffer.from(encoded, "base64"));
    expect(transaction).toBeInstanceOf(TransferTransaction);
    expect(walletKey.publicKey.verifyTransaction(transaction)).toBe(true);
    // The facilitator pays the fee, so the transaction id is under its account.
    expect(transaction.transactionId!.accountId!.toString()).toBe("0.0.7162784");

    const transfers = (transaction as TransferTransaction).hbarTransfers;
    expect(transfers.get("0.0.1001")!.toTinybars().toString()).toBe("-15000000");
    expect(transfers.get("0.0.1002")!.toTinybars().toString()).toBe("15000000");
  });

  test("signs an HTS token transfer", async () => {
    const signer = createPrivyClientHederaSigner(privy(), wallet());
    const encoded = await signer.createPartiallySignedTransferTransaction(requirements({ asset: "0.0.5005", amount: "25" }));

    const transaction = Transaction.fromBytes(Buffer.from(encoded, "base64")) as TransferTransaction;
    expect(walletKey.publicKey.verifyTransaction(transaction)).toBe(true);
    expect(transaction.tokenTransfers.get("0.0.5005")!.get("0.0.1002")!.toString()).toBe("25");
    expect(transaction.hbarTransfers.size).toBe(0);
  });

  test("signs once per node body, with one body per distinct node", async () => {
    const signer = createPrivyClientHederaSigner(privy(), wallet(), { nodeCount: 2 });
    const encoded = await signer.createPartiallySignedTransferTransaction(requirements());
    expect(signRequests()).toHaveLength(2);

    // A node repeated across bodies makes the payload unparseable, and the network map lists a
    // node under several addresses, so this guards the deduplication.
    const nodes = Transaction.fromBytes(Buffer.from(encoded, "base64")).nodeAccountIds!.map(String);
    expect(new Set(nodes).size).toBe(nodes.length);
  });

  test("picks the same nodes every time, so payments don't fail intermittently", async () => {
    const signer = createPrivyClientHederaSigner(privy(), wallet(), { nodeCount: 2 });
    const runs = [];
    for (let attempt = 0; attempt < 3; attempt++) {
      const encoded = await signer.createPartiallySignedTransferTransaction(requirements());
      runs.push(Transaction.fromBytes(Buffer.from(encoded, "base64")).nodeAccountIds!.map(String).join(","));
    }
    expect(new Set(runs).size).toBe(1);
  });

  test("refuses a signature the account's key doesn't match", async () => {
    mode = "wrongKey";
    const signer = createPrivyClientHederaSigner(privy(), wallet());
    await expect(signer.createPartiallySignedTransferTransaction(requirements())).rejects.toThrow("signature Hedera rejects");
  });

  test.each([
    ["no fee payer", requirements({ extra: {} }), "feePayer is required"],
    ["a zero amount", requirements({ amount: "0" }), "greater than zero"],
  ])("refuses requirements with %s", async (_, bad, message) => {
    const signer = createPrivyClientHederaSigner(privy(), wallet());
    await expect(signer.createPartiallySignedTransferTransaction(bad)).rejects.toThrow(message);
  });
});
