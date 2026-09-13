/**
 * Connects out to a provider bridge (apps/bridge), so this provider is reachable without a public
 * IP, domain, or tunnel of its own. Authenticates by signing the bridge's challenge as this
 * identity (see packages/bridge-protocol); answers relayed HTTP requests against this provider's
 * own already-running local server. Reconnects with backoff if the connection drops.
 */
import { forwardableHeaders, type ClientFrame, type RequestFrame, type ServerFrame } from "@decomp/bridge-protocol";
import type { HederaIdentity } from "@decomp/privy-hedera";

/** All the handshake needs: who you claim to be, and the ability to sign a nonce as them. */
export type BridgeIdentity = Pick<HederaIdentity, "accountId" | "signMessage">;

const RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000];

async function handleRequest(ws: WebSocket, frame: RequestFrame, localPort: number, log: (line: string) => void): Promise<void> {
  try {
    const res = await fetch(`http://127.0.0.1:${localPort}${frame.path}`, {
      method: frame.method,
      headers: frame.headers,
      body: frame.body ? Buffer.from(frame.body, "base64") : undefined,
    });
    const bodyBytes = new Uint8Array(await res.arrayBuffer());
    const headers = forwardableHeaders(res.headers);
    const response: ClientFrame = { type: "response", id: frame.id, status: res.status, headers, ...(bodyBytes.length ? { body: Buffer.from(bodyBytes).toString("base64") } : {}) };
    ws.send(JSON.stringify(response));
  } catch (error) {
    log(`bridge: error handling relayed ${frame.method} ${frame.path}: ${error instanceof Error ? error.message : error}`);
    const body = Buffer.from(JSON.stringify({ error: "provider error" })).toString("base64");
    ws.send(JSON.stringify({ type: "response", id: frame.id, status: 502, headers: { "content-type": "application/json" }, body } satisfies ClientFrame));
  }
}

/** Starts (and keeps alive) an outbound connection to the bridge. Fire-and-forget; logs its own status. */
export function connectBridge(bridgeUrl: string, identity: BridgeIdentity, providerId: string, localPort: number, log: (line: string) => void): void {
  let attempt = 0;

  function connect() {
    const ws = new WebSocket(`${bridgeUrl.replace(/^http/, "ws")}/connect`);

    ws.addEventListener("message", event => {
      void (async () => {
        let frame: ServerFrame;
        try {
          frame = JSON.parse(String(event.data)) as ServerFrame;
        } catch {
          return;
        }

        switch (frame.type) {
          case "challenge": {
            const signature = await identity.signMessage(Buffer.from(frame.nonce, "base64"));
            const hello: ClientFrame = { type: "hello", accountId: identity.accountId, providerId, signature: Buffer.from(signature).toString("base64") };
            ws.send(JSON.stringify(hello));
            break;
          }
          case "ready":
            attempt = 0;
            log(`bridge connected as ${identity.accountId}, reachable at ${bridgeUrl}/p/${identity.accountId}`);
            break;
          case "error":
            log(`bridge rejected the connection: ${frame.message}`);
            break;
          case "request":
            await handleRequest(ws, frame, localPort, log);
            break;
        }
      })();
    });

    ws.addEventListener("close", () => {
      const delay = RECONNECT_DELAYS_MS[Math.min(attempt, RECONNECT_DELAYS_MS.length - 1)]!;
      attempt++;
      log(`bridge connection closed; reconnecting in ${delay / 1000}s`);
      setTimeout(connect, delay);
    });
  }

  connect();
}
