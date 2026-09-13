/**
 * Adapted from apps/provider/src/bridge-client.ts: same protocol (packages/bridge-protocol),
 * same behavior, two differences forced by running in Electron's Node main process instead of
 * Bun — the `ws` package instead of Bun's global WebSocket, and an EmbeddedWalletIdentity
 * (accountId + signMessage) instead of a full HederaIdentity, since that's all connecting needs.
 *
 * Promoting apps/provider's connectBridge into packages/bridge-protocol so both apps share one
 * implementation is a reasonable fast-follow — not done here to keep this change scoped.
 */
import WebSocket from "ws";
import { forwardableHeaders, type ClientFrame, type RequestFrame, type ServerFrame } from "@decomp/bridge-protocol";
import type { EmbeddedWalletIdentity } from "./identity/embedded-wallet-identity";

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
    const response: ClientFrame = {
      type: "response",
      id: frame.id,
      status: res.status,
      headers,
      ...(bodyBytes.length ? { body: Buffer.from(bodyBytes).toString("base64") } : {}),
    };
    ws.send(JSON.stringify(response));
  } catch (error) {
    log(`bridge: error handling relayed ${frame.method} ${frame.path}: ${error instanceof Error ? error.message : error}`);
    const body = Buffer.from(JSON.stringify({ error: "provider error" })).toString("base64");
    ws.send(JSON.stringify({ type: "response", id: frame.id, status: 502, headers: { "content-type": "application/json" }, body } satisfies ClientFrame));
  }
}

export type BridgeConnection = { close: () => void };

/** Connects out to the bridge and keeps reconnecting (with backoff) until `close()` is called. */
export function connectBridge(bridgeUrl: string, identity: EmbeddedWalletIdentity, providerId: string, localPort: number, log: (line: string) => void): BridgeConnection {
  let attempt = 0;
  let closed = false;
  let socket: WebSocket | undefined;

  function connect() {
    if (closed) return;
    const ws = new WebSocket(`${bridgeUrl.replace(/^http/, "ws")}/connect`);
    socket = ws;

    ws.on("message", data => {
      void (async () => {
        let frame: ServerFrame;
        try {
          frame = JSON.parse(data.toString()) as ServerFrame;
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

    ws.on("close", () => {
      if (closed) return;
      const delay = RECONNECT_DELAYS_MS[Math.min(attempt, RECONNECT_DELAYS_MS.length - 1)]!;
      attempt++;
      log(`bridge connection closed; reconnecting in ${delay / 1000}s`);
      setTimeout(connect, delay);
    });

    ws.on("error", error => log(`bridge connection error: ${error.message}`));
  }

  connect();
  return {
    close: () => {
      closed = true;
      socket?.close();
    },
  };
}
