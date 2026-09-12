import { describe, expect, test } from "bun:test";
import { challengeFromVerifier, verifyChallenge } from "../src/oauth/pkce";
import { hashToken, randomToken } from "../src/oauth/random";
import { registerClient } from "../src/oauth/register";
import { getClient, getUser, insertRefreshToken, putUser } from "../src/db";
import { lookupRefreshToken, mintAccessToken, mintRefreshToken, rotateRefreshToken, verifyAccessToken } from "../src/oauth/tokens";

const testId = () => crypto.randomUUID();

describe("pkce", () => {
  test("a verifier's own challenge matches", async () => {
    const verifier = randomToken();
    const challenge = await challengeFromVerifier(verifier);
    expect(await verifyChallenge(verifier, challenge)).toBe(true);
  });

  test("a different verifier does not match", async () => {
    const challenge = await challengeFromVerifier(randomToken());
    expect(await verifyChallenge(randomToken(), challenge)).toBe(false);
  });

  test("an empty verifier or challenge never matches", async () => {
    expect(await verifyChallenge("", await challengeFromVerifier("x"))).toBe(false);
    expect(await verifyChallenge("x", "")).toBe(false);
  });
});

describe("random tokens", () => {
  test("hashToken is deterministic and never equals the raw token", async () => {
    const token = randomToken();
    const hash = await hashToken(token);
    expect(hash).toBe(await hashToken(token));
    expect(hash).not.toBe(token);
  });

  test("two random tokens don't collide", () => {
    expect(randomToken()).not.toBe(randomToken());
  });
});

describe("dynamic client registration", () => {
  test("registers a client with valid https redirect_uris", async () => {
    const res = await registerClient(
      new Request("http://x/register", { method: "POST", body: JSON.stringify({ redirect_uris: ["https://claude.ai/api/mcp/callback"] }) }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { client_id: string; redirect_uris: string[] };
    expect(body.client_id).toBeTruthy();
    expect(body.redirect_uris).toEqual(["https://claude.ai/api/mcp/callback"]);
    expect(getClient(body.client_id)?.client_id).toBe(body.client_id);
  });

  test("accepts localhost/127.0.0.1 redirect_uris for local testing", async () => {
    const res = await registerClient(new Request("http://x/register", { method: "POST", body: JSON.stringify({ redirect_uris: ["http://127.0.0.1:9999/cb"] }) }));
    expect(res.status).toBe(201);
  });

  test("rejects a request with no redirect_uris", async () => {
    const res = await registerClient(new Request("http://x/register", { method: "POST", body: JSON.stringify({}) }));
    expect(res.status).toBe(400);
  });

  test("rejects a non-https, non-local redirect_uri", async () => {
    const res = await registerClient(new Request("http://x/register", { method: "POST", body: JSON.stringify({ redirect_uris: ["http://evil.example/cb"] }) }));
    expect(res.status).toBe(400);
  });

  test("rejects a redirect_uri with a fragment", async () => {
    const res = await registerClient(
      new Request("http://x/register", { method: "POST", body: JSON.stringify({ redirect_uris: ["https://claude.ai/cb#frag"] }) }),
    );
    expect(res.status).toBe(400);
  });
});

describe("access tokens", () => {
  test("a minted token verifies for the default (mcp) resource", async () => {
    const did = `did:privy:${testId()}`;
    const { token } = await mintAccessToken({ sub: did, client_id: testId() });
    const claims = await verifyAccessToken(token);
    expect(claims?.sub).toBe(did);
  });

  test("a garbage token fails to verify", async () => {
    expect(await verifyAccessToken("not.a.jwt")).toBeNull();
  });

  test("a token minted for one resource does not verify against another", async () => {
    const { token } = await mintAccessToken({ sub: `did:privy:${testId()}`, client_id: testId() }, "https://a.example/mcp");
    expect(await verifyAccessToken(token, "https://b.example/mcp")).toBeNull();
  });
});

describe("refresh tokens", () => {
  test("mint, look up, rotate, and detect reuse", async () => {
    const did = `did:privy:${testId()}`;
    const clientId = testId();
    const first = await mintRefreshToken(did, clientId, undefined);

    const found = await lookupRefreshToken(first);
    expect(found.ok).toBe(true);
    if (!found.ok) throw new Error("unreachable");

    const second = await rotateRefreshToken(found.row);
    expect(second).not.toBe(first);

    // The old token is now revoked; using it again must fail and revoke the whole chain.
    const reused = await lookupRefreshToken(first);
    expect(reused).toEqual({ ok: false, reason: "revoked" });

    const secondNowRevokedToo = await lookupRefreshToken(second);
    expect(secondNowRevokedToo).toEqual({ ok: false, reason: "revoked" });
  });

  test("an unknown token is not_found", async () => {
    expect(await lookupRefreshToken(randomToken())).toEqual({ ok: false, reason: "not_found" });
  });

  test("an expired token is rejected", async () => {
    const token = randomToken();
    insertRefreshToken({
      token_hash: await hashToken(token),
      client_id: testId(),
      user_did: `did:privy:${testId()}`,
      resource: null,
      rotated_from: null,
      expires_at: Date.now() - 1,
    });
    expect(await lookupRefreshToken(token)).toEqual({ ok: false, reason: "expired" });
  });
});

describe("user cache", () => {
  test("putUser then getUser round-trips", async () => {
    const did = `did:privy:${testId()}`;
    putUser(did, "wallet_1", "0.0.999999");
    expect(getUser(did)).toEqual({ did, wallet_id: "wallet_1", account_id: "0.0.999999", created_at: expect.any(Number) });
  });
});
