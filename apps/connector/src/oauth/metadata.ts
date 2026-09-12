/** OAuth discovery documents Claude's connector flow reads before anything else. */
import { env } from "../env";

/** RFC 9728: tells a client where the authorization server for the /mcp resource is. */
export function protectedResourceMetadata(): Response {
  return Response.json({
    resource: `${env.baseUrl}/mcp`,
    authorization_servers: [env.baseUrl],
    bearer_methods_supported: ["header"],
  });
}

/** RFC 8414: tells a client this connector's own OAuth endpoints. */
export function authorizationServerMetadata(): Response {
  return Response.json({
    issuer: env.baseUrl,
    authorization_endpoint: `${env.baseUrl}/authorize`,
    token_endpoint: `${env.baseUrl}/token`,
    registration_endpoint: `${env.baseUrl}/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
  });
}
