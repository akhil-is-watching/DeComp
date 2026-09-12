/**
 * MCP Streamable HTTP transport, hand-rolled on Bun.serve (this repo already prefers that over
 * Node-http-shaped middleware — see packages/hedera-x402/src/bun-gate.ts for the x402 gate taking
 * the same approach). Single JSON request/response per call; no SSE stream, since every tool call
 * already blocks on its own polling (runJob) and returns one final result — a deliberate v1 cut,
 * documented in docs/ARCHITECTURE.md.
 */
import { SUPPORTED_PROTOCOL_VERSIONS, LATEST_PROTOCOL_VERSION, type JSONRPCRequest } from "@modelcontextprotocol/sdk/types.js";
import type { HederaIdentity } from "@decomp/privy-hedera";
import { identityFor } from "../identity";
import { authenticate, unauthorized } from "./auth";
import { callTool, TOOLS } from "./tools";

const SERVER_INFO = { name: "decomp-connector", version: "0.1.0" };
const sessions = new Set<string>();

function rpcResult(id: unknown, result: unknown): Response {
  return Response.json({ jsonrpc: "2.0", id, result });
}

function rpcError(id: unknown, code: number, message: string): Response {
  return Response.json({ jsonrpc: "2.0", id, error: { code, message } });
}

async function dispatch(body: JSONRPCRequest, getIdentity: () => Promise<HederaIdentity>): Promise<{ response: Response; sessionId?: string }> {
  switch (body.method) {
    case "initialize": {
      const requested = (body.params as { protocolVersion?: string } | undefined)?.protocolVersion;
      const protocolVersion = requested && SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : LATEST_PROTOCOL_VERSION;
      const sessionId = crypto.randomUUID();
      sessions.add(sessionId);
      return {
        response: rpcResult(body.id, { protocolVersion, capabilities: { tools: {} }, serverInfo: SERVER_INFO }),
        sessionId,
      };
    }
    case "tools/list":
      return { response: rpcResult(body.id, { tools: TOOLS }) };
    case "tools/call": {
      const params = body.params as { name: string; arguments?: Record<string, unknown> };
      const result = await callTool(params.name, params.arguments ?? {}, await getIdentity());
      return { response: rpcResult(body.id, result) };
    }
    case "ping":
      return { response: rpcResult(body.id, {}) };
    case "notifications/initialized":
      return { response: new Response(null, { status: 202 }) };
    default:
      return { response: rpcError(body.id, -32601, `method not found: ${body.method}`) };
  }
}

export async function handleMcpRequest(req: Request): Promise<Response> {
  const claims = await authenticate(req);
  if (!claims) return unauthorized();

  const body = (await req.json().catch(() => undefined)) as JSONRPCRequest | undefined;
  if (!body || body.jsonrpc !== "2.0" || typeof body.method !== "string") {
    return Response.json({ jsonrpc: "2.0", id: (body as { id?: unknown } | undefined)?.id ?? null, error: { code: -32600, message: "invalid request" } });
  }

  const { response, sessionId } = await dispatch(body, () => identityFor(claims.sub));
  if (sessionId) response.headers.set("mcp-session-id", sessionId);
  return response;
}

export function deleteMcpSession(req: Request): Response {
  const sessionId = req.headers.get("mcp-session-id");
  if (sessionId) sessions.delete(sessionId);
  return new Response(null, { status: 204 });
}
