/**
 * The connector's own tokens — separate from Privy's. Access tokens are short-lived, stateless
 * JWTs (HS256 over CONNECTOR_TOKEN_SECRET); the tradeoff is no revocation before expiry, which is
 * acceptable at a 1h lifetime and is called out in the docs. Refresh tokens are opaque and rotate
 * on every use; only their hash is ever persisted (see db.ts).
 */
import { jwtVerify, SignJWT } from "jose";
import { env } from "../env";
import { getRefreshToken, insertRefreshToken, revokeRefreshChain, revokeRefreshToken, type RefreshToken } from "../db";
import { hashToken, randomToken } from "./random";

const ACCESS_TOKEN_TTL_S = 60 * 60; // 1h
const REFRESH_TOKEN_TTL_S = 60 * 60 * 24 * 30; // 30d

function secretKey(): Uint8Array {
  return new TextEncoder().encode(env.tokenSecret);
}

export type AccessTokenClaims = { sub: string; client_id: string };

export async function mintAccessToken(claims: AccessTokenClaims, resource?: string): Promise<{ token: string; expiresIn: number }> {
  const token = await new SignJWT({ client_id: claims.client_id })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setIssuer(env.baseUrl)
    .setAudience(resource ?? `${env.baseUrl}/mcp`)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TOKEN_TTL_S}s`)
    .sign(secretKey());
  return { token, expiresIn: ACCESS_TOKEN_TTL_S };
}

/** Verifies an access token against this connector's own resource audience. Never throws. */
export async function verifyAccessToken(token: string, resource?: string): Promise<AccessTokenClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), {
      issuer: env.baseUrl,
      audience: resource ?? `${env.baseUrl}/mcp`,
    });
    if (typeof payload.sub !== "string" || typeof payload.client_id !== "string") return null;
    return { sub: payload.sub, client_id: payload.client_id };
  } catch {
    return null;
  }
}

export async function mintRefreshToken(did: string, clientId: string, resource: string | undefined, rotatedFrom?: string): Promise<string> {
  const token = randomToken();
  insertRefreshToken({
    token_hash: await hashToken(token),
    client_id: clientId,
    user_did: did,
    resource: resource ?? null,
    rotated_from: rotatedFrom ?? null,
    expires_at: Date.now() + REFRESH_TOKEN_TTL_S * 1000,
  });
  return token;
}

export type RefreshOutcome =
  | { ok: true; row: RefreshToken }
  | { ok: false; reason: "not_found" | "expired" | "revoked" };

/** Looks up a refresh token by its raw value; reuse of an already-revoked one flags the whole chain. */
export async function lookupRefreshToken(token: string): Promise<RefreshOutcome> {
  const hash = await hashToken(token);
  const row = getRefreshToken(hash);
  if (!row) return { ok: false, reason: "not_found" };
  if (row.revoked) {
    revokeRefreshChain(row.user_did, row.client_id);
    return { ok: false, reason: "revoked" };
  }
  if (row.expires_at < Date.now()) return { ok: false, reason: "expired" };
  return { ok: true, row };
}

/** Rotates a refresh token: revokes the old one and mints its successor. */
export async function rotateRefreshToken(row: RefreshToken): Promise<string> {
  revokeRefreshToken(row.token_hash);
  return mintRefreshToken(row.user_did, row.client_id, row.resource ?? undefined, row.token_hash);
}
