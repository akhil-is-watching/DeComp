/**
 * POST /authorize/callback — called by the browser login page once Privy authentication succeeds
 * client-side. This is the actual security boundary for the flow: client_id and redirect_uri are
 * re-validated here against the registered client (never trusting what the page sent alone), so a
 * code is only ever minted for a redirect this connector itself vouches for. GET /authorize is a
 * static page (wired directly in index.ts); it has nothing to validate since it never redirects —
 * only this handler does, and only after the checks below pass.
 */
import { verifyPrivyAccessToken } from "../privy-verify";
import { getClient, insertAuthCode } from "../db";
import { randomToken } from "./random";

const AUTH_CODE_TTL_MS = 60_000;

type CallbackBody = {
  privyAccessToken?: string;
  client_id?: string;
  redirect_uri?: string;
  code_challenge?: string;
  code_challenge_method?: string;
  state?: string;
  resource?: string;
};

export async function authorizeCallback(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => undefined)) as CallbackBody | undefined;
  if (!body?.client_id || !body.redirect_uri || !body.code_challenge || !body.privyAccessToken) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }
  if (body.code_challenge_method !== "S256") {
    return Response.json({ error: "invalid_request", error_description: "code_challenge_method must be S256" }, { status: 400 });
  }

  const client = getClient(body.client_id);
  const redirectUris = client ? (JSON.parse(client.redirect_uris) as string[]) : [];
  if (!client || !redirectUris.includes(body.redirect_uri)) {
    return Response.json({ error: "invalid_client", error_description: "unknown client_id or redirect_uri" }, { status: 400 });
  }

  const did = await verifyPrivyAccessToken(body.privyAccessToken);
  if (!did) {
    return Response.json({ error: "access_denied", error_description: "Privy login could not be verified" }, { status: 401 });
  }

  const code = randomToken();
  insertAuthCode({
    code,
    client_id: body.client_id,
    redirect_uri: body.redirect_uri,
    code_challenge: body.code_challenge,
    code_challenge_method: body.code_challenge_method,
    resource: body.resource ?? null,
    user_did: did,
    expires_at: Date.now() + AUTH_CODE_TTL_MS,
  });

  const redirect = new URL(body.redirect_uri);
  redirect.searchParams.set("code", code);
  if (body.state) redirect.searchParams.set("state", body.state);
  return Response.json({ redirect: redirect.toString() });
}
