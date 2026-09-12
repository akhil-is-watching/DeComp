/**
 * Verifies a Privy access token server-side, per Privy's documented scheme: an ES256 JWT with
 * `iss: "privy.io"`, `aud: <app id>`, and `sub` holding the user's Privy DID. No Privy SDK is used
 * here — this stays on plain `jose`, the same zero-extra-SDK approach as packages/privy-hedera's
 * signing client. Keys come from the app's JWKS endpoint, which is public (it only verifies,
 * never signs) and rotates on Privy's side without this connector needing to change; the app
 * secret that actually authorizes wallet signing is never involved in this path.
 */
import { createRemoteJWKSet, jwtVerify } from "jose";
import { env } from "./env";

// createRemoteJWKSet caches fetched keys and rate-limits refetches itself, so build it once for
// the configured URL and reuse it — a fresh one per call would throw that caching away.
let cachedJwks: { url: string; getKey: ReturnType<typeof createRemoteJWKSet> } | undefined;

function jwks() {
  if (cachedJwks?.url !== env.privyJwksUrl) cachedJwks = { url: env.privyJwksUrl, getKey: createRemoteJWKSet(new URL(env.privyJwksUrl)) };
  return cachedJwks.getKey;
}

/** The verified user's Privy DID, or null if the token doesn't check out. Never throws. */
export async function verifyPrivyAccessToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, jwks(), { issuer: "privy.io", audience: env.privyAppId });
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}
