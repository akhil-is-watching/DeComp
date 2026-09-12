/** POST /token — authorization_code (with PKCE) and refresh_token grants. */
import { consumeAuthCode, getClient } from "../db";
import { getOrCreateUserWallet } from "../identity";
import { verifyChallenge } from "./pkce";
import { lookupRefreshToken, mintAccessToken, mintRefreshToken, rotateRefreshToken } from "./tokens";

function tokenError(error: string, description?: string, status = 400): Response {
  return Response.json({ error, ...(description ? { error_description: description } : {}) }, { status });
}

async function handleAuthorizationCode(params: URLSearchParams): Promise<Response> {
  const code = params.get("code");
  const clientId = params.get("client_id");
  const redirectUri = params.get("redirect_uri");
  const verifier = params.get("code_verifier");
  if (!code || !clientId || !redirectUri || !verifier) return tokenError("invalid_request");

  const row = consumeAuthCode(code);
  if (!row) return tokenError("invalid_grant", "the authorization code is invalid, used, or expired");
  if (row.client_id !== clientId || row.redirect_uri !== redirectUri) {
    return tokenError("invalid_grant", "client_id/redirect_uri do not match the authorization request");
  }
  if (!(await verifyChallenge(verifier, row.code_challenge))) {
    return tokenError("invalid_grant", "code_verifier does not match code_challenge");
  }
  if (!getClient(clientId)) return tokenError("invalid_client");

  // First token exchange for this user provisions their wallet + Hedera account.
  await getOrCreateUserWallet(row.user_did);

  const resource = row.resource ?? undefined;
  const { token: accessToken, expiresIn } = await mintAccessToken({ sub: row.user_did, client_id: clientId }, resource);
  const refreshToken = await mintRefreshToken(row.user_did, clientId, resource);
  return Response.json({ access_token: accessToken, token_type: "Bearer", expires_in: expiresIn, refresh_token: refreshToken });
}

async function handleRefreshToken(params: URLSearchParams): Promise<Response> {
  const refreshToken = params.get("refresh_token");
  const clientId = params.get("client_id");
  if (!refreshToken || !clientId) return tokenError("invalid_request");

  const found = await lookupRefreshToken(refreshToken);
  if (!found.ok) {
    return tokenError("invalid_grant", `refresh token ${found.reason}`);
  }
  if (found.row.client_id !== clientId) return tokenError("invalid_grant", "refresh token was not issued to this client");

  const resource = found.row.resource ?? undefined;
  const { token: accessToken, expiresIn } = await mintAccessToken({ sub: found.row.user_did, client_id: clientId }, resource);
  const nextRefreshToken = await rotateRefreshToken(found.row);
  return Response.json({ access_token: accessToken, token_type: "Bearer", expires_in: expiresIn, refresh_token: nextRefreshToken });
}

export async function tokenEndpoint(req: Request): Promise<Response> {
  const contentType = req.headers.get("content-type") ?? "";
  const params = contentType.includes("application/json")
    ? new URLSearchParams(Object.entries((await req.json().catch(() => ({}))) as Record<string, string>))
    : new URLSearchParams(await req.text());

  switch (params.get("grant_type")) {
    case "authorization_code":
      return handleAuthorizationCode(params);
    case "refresh_token":
      return handleRefreshToken(params);
    default:
      return tokenError("unsupported_grant_type");
  }
}
