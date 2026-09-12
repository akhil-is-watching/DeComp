/** Bearer-token auth for the /mcp resource, per the MCP authorization spec's 401 challenge shape. */
import { verifyAccessToken, type AccessTokenClaims } from "../oauth/tokens";
import { env } from "../env";

export async function authenticate(req: Request): Promise<AccessTokenClaims | null> {
  const header = req.headers.get("authorization");
  const token = header?.match(/^Bearer (.+)$/i)?.[1];
  if (!token) return null;
  return verifyAccessToken(token);
}

export function unauthorized(): Response {
  return new Response(JSON.stringify({ error: "unauthorized" }), {
    status: 401,
    headers: {
      "content-type": "application/json",
      "www-authenticate": `Bearer resource_metadata="${env.baseUrl}/.well-known/oauth-protected-resource"`,
    },
  });
}
