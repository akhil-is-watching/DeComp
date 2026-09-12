/**
 * The full authorization_code + PKCE + refresh_token dance, against a fake Privy login (a
 * self-signed ES256 token verified with a throwaway keypair set as PRIVY_VERIFICATION_KEY) so no
 * real Privy dashboard credential is needed to test the OAuth mechanics. The test DID is
 * pre-cached against the real AGENT wallet/account so the one real network call this test makes
 * (`privy.getWallet`) is a cheap, read-only lookup of a wallet that already exists — no new wallet
 * or Hedera account is created, and nothing is spent.
 */
import { describe, expect, test } from "bun:test";
import { exportSPKI, generateKeyPair, SignJWT } from "jose";
import { challengeFromVerifier } from "../src/oauth/pkce";
import { randomToken } from "../src/oauth/random";
import { authorizeCallback } from "../src/oauth/authorize";
import { registerClient } from "../src/oauth/register";
import { tokenEndpoint } from "../src/oauth/token";
import { putUser } from "../src/db";

// privy-verify.ts caches the imported verification key for the process's lifetime (correct in
// production, where it's static) — so every fake login in this file signs against the same
// keypair, set once, rather than each minting its own that a cached import would never pick up.
const privyTestKeys = await generateKeyPair("ES256");
process.env.PRIVY_VERIFICATION_KEY = await exportSPKI(privyTestKeys.publicKey);

async function fakePrivyLogin(): Promise<{ did: string; accessToken: string }> {
  const did = `did:privy:test-${crypto.randomUUID()}`;
  const accessToken = await new SignJWT({})
    .setProtectedHeader({ alg: "ES256" })
    .setSubject(did)
    .setIssuer("privy.io")
    .setAudience(process.env.PRIVY_APP_ID!)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privyTestKeys.privateKey);
  return { did, accessToken };
}

async function registeredClient(redirectUri: string) {
  const res = await registerClient(new Request("http://x/register", { method: "POST", body: JSON.stringify({ redirect_uris: [redirectUri] }) }));
  return (await res.json()) as { client_id: string };
}

describe("authorization_code + PKCE + refresh_token, end to end", () => {
  test("full round trip", async () => {
    const redirectUri = "https://claude.ai/api/mcp/callback";
    const { client_id } = await registeredClient(redirectUri);
    const { did, accessToken } = await fakePrivyLogin();
    putUser(did, process.env.AGENT_WALLET_ID!, process.env.AGENT_ACCOUNT_ID!);

    const verifier = randomToken();
    const challenge = await challengeFromVerifier(verifier);

    // 1. The login page's callback, after Privy auth succeeds client-side.
    const callbackRes = await authorizeCallback(
      new Request("http://x/authorize/callback", {
        method: "POST",
        body: JSON.stringify({
          privyAccessToken: accessToken,
          client_id,
          redirect_uri: redirectUri,
          code_challenge: challenge,
          code_challenge_method: "S256",
          state: "xyz123",
        }),
      }),
    );
    expect(callbackRes.status).toBe(200);
    const { redirect } = (await callbackRes.json()) as { redirect: string };
    const redirectUrl = new URL(redirect);
    expect(redirectUrl.origin + redirectUrl.pathname).toBe(redirectUri);
    expect(redirectUrl.searchParams.get("state")).toBe("xyz123");
    const code = redirectUrl.searchParams.get("code")!;
    expect(code).toBeTruthy();

    // 2. Claude exchanges the code (+ verifier) for tokens.
    const tokenRes = await tokenEndpoint(
      new Request("http://x/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "authorization_code", code, client_id, redirect_uri: redirectUri, code_verifier: verifier }).toString(),
      }),
    );
    expect(tokenRes.status).toBe(200);
    const tokens = (await tokenRes.json()) as { access_token: string; refresh_token: string; token_type: string };
    expect(tokens.token_type).toBe("Bearer");
    expect(tokens.access_token).toBeTruthy();
    expect(tokens.refresh_token).toBeTruthy();

    // 3. The same code can't be redeemed twice.
    const replay = await tokenEndpoint(
      new Request("http://x/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "authorization_code", code, client_id, redirect_uri: redirectUri, code_verifier: verifier }).toString(),
      }),
    );
    expect(replay.status).toBe(400);

    // 4. The refresh token rotates and yields a fresh access token.
    const refreshRes = await tokenEndpoint(
      new Request("http://x/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id }).toString(),
      }),
    );
    expect(refreshRes.status).toBe(200);
    const refreshed = (await refreshRes.json()) as { access_token: string; refresh_token: string };
    expect(refreshed.refresh_token).not.toBe(tokens.refresh_token);

    // 5. The old refresh token is now revoked (reuse detection).
    const reuse = await tokenEndpoint(
      new Request("http://x/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id }).toString(),
      }),
    );
    expect(reuse.status).toBe(400);
  });

  test("a wrong PKCE verifier is rejected at the token endpoint", async () => {
    const redirectUri = "https://claude.ai/api/mcp/callback";
    const { client_id } = await registeredClient(redirectUri);
    const { did, accessToken } = await fakePrivyLogin();
    putUser(did, process.env.AGENT_WALLET_ID!, process.env.AGENT_ACCOUNT_ID!);
    const challenge = await challengeFromVerifier(randomToken());

    const callbackRes = await authorizeCallback(
      new Request("http://x/authorize/callback", {
        method: "POST",
        body: JSON.stringify({ privyAccessToken: accessToken, client_id, redirect_uri: redirectUri, code_challenge: challenge, code_challenge_method: "S256" }),
      }),
    );
    const { redirect } = (await callbackRes.json()) as { redirect: string };
    const code = new URL(redirect).searchParams.get("code")!;

    const tokenRes = await tokenEndpoint(
      new Request("http://x/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "authorization_code", code, client_id, redirect_uri: redirectUri, code_verifier: randomToken() }).toString(),
      }),
    );
    expect(tokenRes.status).toBe(400);
  });

  test("a redirect_uri not registered for the client is refused before any Privy verification", async () => {
    const { client_id } = await registeredClient("https://claude.ai/api/mcp/callback");
    const res = await authorizeCallback(
      new Request("http://x/authorize/callback", {
        method: "POST",
        body: JSON.stringify({
          privyAccessToken: "irrelevant",
          client_id,
          redirect_uri: "https://evil.example/cb",
          code_challenge: await challengeFromVerifier(randomToken()),
          code_challenge_method: "S256",
        }),
      }),
    );
    expect(res.status).toBe(400);
  });

  test("an unverifiable Privy token never yields a code", async () => {
    const redirectUri = "https://claude.ai/api/mcp/callback";
    const { client_id } = await registeredClient(redirectUri);
    const res = await authorizeCallback(
      new Request("http://x/authorize/callback", {
        method: "POST",
        body: JSON.stringify({
          privyAccessToken: "not-a-real-token",
          client_id,
          redirect_uri: redirectUri,
          code_challenge: await challengeFromVerifier(randomToken()),
          code_challenge_method: "S256",
        }),
      }),
    );
    expect(res.status).toBe(401);
  });
});
