/**
 * DeComp's Claude connector: a remote MCP server, fronted by its own minimal OAuth 2.1 AS/RS.
 * A person adds this app's URL as a custom connector in Claude, signs in once via Privy, and the
 * GPU jobs they ask for in chat are paid for by their own Privy-signed Hedera wallet — no key, no
 * terminal, no .env on their side. See docs/ARCHITECTURE.md's "Claude connector" section.
 */
import loginPage from "./login.html";
import { env } from "./env";
import "./db"; // opens (and migrates) the sqlite store on boot
import { authorizationServerMetadata, protectedResourceMetadata } from "./oauth/metadata";
import { registerClient } from "./oauth/register";
import { authorizeCallback } from "./oauth/authorize";
import { tokenEndpoint } from "./oauth/token";
import { deleteMcpSession, handleMcpRequest } from "./mcp/transport";

const server = Bun.serve({
  port: env.port,
  routes: {
    "/.well-known/oauth-protected-resource": { GET: () => protectedResourceMetadata() },
    "/.well-known/oauth-protected-resource/mcp": { GET: () => protectedResourceMetadata() },
    "/.well-known/oauth-authorization-server": { GET: () => authorizationServerMetadata() },
    "/register": { POST: registerClient },
    "/authorize": loginPage,
    "/authorize/callback": { POST: authorizeCallback },
    "/token": { POST: tokenEndpoint },
    "/connector-config": { GET: () => Response.json({ privyAppId: env.privyAppId }) },
    "/mcp": { POST: handleMcpRequest, DELETE: deleteMcpSession },
    "/health": { GET: () => Response.json({ status: "ok" }) },
    // The bare origin isn't the MCP endpoint — that's /mcp — so say so instead of a bare 404,
    // since it's an easy thing to paste into Claude's "Add custom connector" URL field by habit.
    "/": { GET: () => Response.json({ name: "decomp-connector", mcp: `${env.baseUrl}/mcp`, docs: "https://github.com/akhil-is-watching/DeComp" }) },
  },
  fetch: () => Response.json({ error: "not found" }, { status: 404 }),
});

console.log(`[connector] listening on ${server.url}`);
console.log(`[connector] public base URL: ${env.baseUrl}`);
if (env.baseUrl.startsWith("http://127.0.0.1") || env.baseUrl.startsWith("http://localhost")) {
  console.log("[connector] CONNECTOR_BASE_URL is local; claude.ai can't reach it — use a tunnel (e.g. ngrok) to add this as a real connector");
}
