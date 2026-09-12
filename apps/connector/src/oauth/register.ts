/** RFC 7591 dynamic client registration — claude.ai calls this itself when a user adds the connector URL. */
import { insertClient } from "../db";

function isValidRedirectUri(uri: unknown): uri is string {
  if (typeof uri !== "string") return false;
  try {
    const parsed = new URL(uri);
    if (parsed.hash) return false; // RFC 6749 §3.1.2: no fragment
    return parsed.protocol === "https:" || parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

export async function registerClient(req: Request): Promise<Response> {
  const body = await req.json().catch(() => undefined);
  const redirectUris = (body as { redirect_uris?: unknown } | undefined)?.redirect_uris;
  if (!Array.isArray(redirectUris) || redirectUris.length === 0 || !redirectUris.every(isValidRedirectUri)) {
    return Response.json(
      { error: "invalid_client_metadata", error_description: "redirect_uris must be a non-empty array of https (or localhost) URLs with no fragment" },
      { status: 400 },
    );
  }

  const clientId = crypto.randomUUID();
  const clientName = typeof (body as { client_name?: unknown }).client_name === "string" ? (body as { client_name: string }).client_name : null;
  const grantTypes = ["authorization_code", "refresh_token"];
  insertClient({
    client_id: clientId,
    client_name: clientName,
    redirect_uris: JSON.stringify(redirectUris),
    token_endpoint_auth_method: "none",
    grant_types: JSON.stringify(grantTypes),
  });

  return Response.json(
    {
      client_id: clientId,
      client_name: clientName,
      redirect_uris: redirectUris,
      token_endpoint_auth_method: "none",
      grant_types: grantTypes,
      response_types: ["code"],
    },
    { status: 201 },
  );
}
