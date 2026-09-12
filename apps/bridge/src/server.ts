/**
 * The provider bridge: a relay that lets a GPU provider behind NAT (no public IP, no domain, no
 * tunnel account) be reached over the internet. A provider opens one persistent WebSocket
 * connection out to this service and proves control of its Hedera account; HTTP requests to
 * /p/<accountId>/... are then relayed over that socket to the provider's own local HTTP API and
 * the response relayed back. The provider registers on HCS with this bridge's URL as its
 * `endpoint` instead of its own address — see docs/ARCHITECTURE.md's "Provider bridge" section.
 *
 * This service holds no keys and does no signing; it only verifies a signature against what the
 * mirror node reports (packages/bridge-protocol's verifyHello), so "anyone can be a provider"
 * without ever trusting this relay with anything more than plaintext HTTP in transit.
 */
import { randomNonce, verifyHello, parseClientFrame, type RequestFrame } from "@decomp/bridge-protocol";
import { forwardRequest, getConnection, listConnections, registerConnection, resolvePending, unregisterConnection, type Sender } from "./connections";

type WSData = { nonce: string; authenticated: boolean; accountId?: string; providerId?: string; send: Sender };

const PROXY_PREFIX = "/p/";
const FORWARDED_REQUEST_HEADERS = ["content-type"];

async function handleProxy(req: Request, url: URL): Promise<Response> {
  const rest = url.pathname.slice(PROXY_PREFIX.length);
  const slash = rest.indexOf("/");
  const accountId = slash === -1 ? rest : rest.slice(0, slash);
  const path = (slash === -1 ? "" : rest.slice(slash)) + url.search;
  if (!accountId) return Response.json({ error: "no provider account in path; expected /p/<accountId>/..." }, { status: 400 });

  if (!getConnection(accountId)) {
    return Response.json({ error: `${accountId} is not connected to the bridge` }, { status: 503 });
  }

  const headers: Record<string, string> = {};
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = req.headers.get(name);
    if (value) headers[name] = value;
  }
  const bodyBytes = req.body ? new Uint8Array(await req.arrayBuffer()) : undefined;
  const frame: RequestFrame = {
    type: "request",
    id: crypto.randomUUID(),
    method: req.method,
    path: path || "/",
    headers,
    ...(bodyBytes ? { body: Buffer.from(bodyBytes).toString("base64") } : {}),
  };

  try {
    const response = await forwardRequest(accountId, frame);
    return new Response(response.body ? Buffer.from(response.body, "base64") : undefined, { status: response.status, headers: response.headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "not_connected") return Response.json({ error: `${accountId} is not connected to the bridge` }, { status: 503 });
    if (message === "timeout") return Response.json({ error: "provider did not respond in time" }, { status: 504 });
    return Response.json({ error: "bridge error", detail: message }, { status: 502 });
  }
}

export function createBridgeServer(port = 0) {
  return Bun.serve<WSData>({
    port,
    async fetch(req, server) {
      const url = new URL(req.url);

      if (url.pathname === "/connect") {
        const nonce = randomNonce();
        const send: Sender = () => {}; // replaced once the socket is actually open, see websocket.open
        const upgraded = server.upgrade(req, { data: { nonce, authenticated: false, send } });
        return upgraded ? undefined : new Response("expected a WebSocket upgrade", { status: 400 });
      }

      if (url.pathname === "/health") {
        return Response.json({ status: "ok", connections: listConnections().length });
      }

      if (url.pathname.startsWith(PROXY_PREFIX)) {
        return handleProxy(req, url);
      }

      if (url.pathname === "/") {
        // Prefer the configured public URL (production); fall back to the actual bind address,
        // which is what matters for local dev and for tests bound to a random port.
        const base = process.env.BRIDGE_BASE_URL || `http://${server.hostname}:${server.port}`;
        return Response.json({ name: "decomp-bridge", connect: `${base.replace(/^http/, "ws")}/connect`, proxy: `${base}/p/<accountId>/...` });
      }

      return Response.json({ error: "not found" }, { status: 404 });
    },
    websocket: {
      open(ws) {
        ws.data.send = frame => ws.send(JSON.stringify(frame));
        ws.send(JSON.stringify({ type: "challenge", nonce: ws.data.nonce }));
      },
      async message(ws, raw) {
        // Every byte here is untrusted input from anyone who can open a connection; a bug or an
        // adversarial frame must close the socket cleanly, never hang it or the caller.
        try {
          const frame = parseClientFrame(String(raw));
          if (!frame) return;

          if (!ws.data.authenticated) {
            if (frame.type !== "hello") return;
            const check = await verifyHello(frame, ws.data.nonce);
            if (!check.ok) {
              ws.send(JSON.stringify({ type: "error", message: check.reason }));
              ws.close(4001, check.reason);
              return;
            }
            ws.data.authenticated = true;
            ws.data.accountId = frame.accountId;
            ws.data.providerId = frame.providerId;
            // A fresh, authenticated connection replaces any stale one for the same account.
            const replaced = registerConnection(frame.accountId, frame.providerId, ws.data.send, reason => ws.close(4002, reason));
            replaced?.close("replaced by a newer connection");
            ws.send(JSON.stringify({ type: "ready" }));
            return;
          }

          if (frame.type === "response") resolvePending(frame);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          ws.send(JSON.stringify({ type: "error", message: `internal error: ${message}` }));
          ws.close(4000, "internal error");
        }
      },
      close(ws) {
        if (ws.data.accountId) unregisterConnection(ws.data.accountId, ws.data.send);
      },
    },
  });
}
