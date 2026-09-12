/**
 * Full round trip against a real bridge server: a fake "provider" WebSocket client authenticates
 * with the real AGENT identity's signature (no stub — same reasoning as bridge-protocol's auth
 * tests), then answers one relayed request itself, and an HTTP client hits /p/<accountId>/... to
 * get it. No Hedera fees are involved (a signature, not a transaction), just a real mirror-node
 * lookup and a real Privy signature.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { privyIdentity, type HederaIdentity } from "@decomp/privy-hedera";
import type { ClientFrame, RequestFrame, ServerFrame } from "@decomp/bridge-protocol";
import { createBridgeServer } from "../src/server";

let server: ReturnType<typeof createBridgeServer>;
let agent: HederaIdentity;
let baseUrl: string;

beforeAll(async () => {
  server = createBridgeServer(0);
  baseUrl = `http://127.0.0.1:${server.port}`;
  agent = await privyIdentity("AGENT");
});
// server.stop(true) can hang waiting on a connection that's already mid-close from a prior test
// (e.g. the "replaced" or "rejected" sockets) even with force=true — bound it so the suite always
// finishes; the test process exits right after anyway, so nothing is actually left running.
afterAll(async () => {
  await Promise.race([server.stop(true), Bun.sleep(2000)]);
});

/** Connects, authenticates as `identity`, and answers relayed requests with `handle`. Resolves once authenticated. */
async function connectFakeProvider(identity: HederaIdentity, handle: (req: RequestFrame) => { status: number; body?: string }): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${server.port}/connect`);
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener("message", async event => {
      const frame = JSON.parse(event.data as string) as ServerFrame;
      if (frame.type === "challenge") {
        const signature = await identity.signMessage(Buffer.from(frame.nonce, "base64"));
        const hello: ClientFrame = { type: "hello", accountId: identity.accountId, providerId: "test-provider", signature: Buffer.from(signature).toString("base64") };
        ws.send(JSON.stringify(hello));
      } else if (frame.type === "ready") {
        resolve();
      } else if (frame.type === "error") {
        reject(new Error(frame.message));
      } else if (frame.type === "request") {
        const { status, body } = handle(frame);
        const response: ClientFrame = { type: "response", id: frame.id, status, headers: { "content-type": "application/json" }, ...(body ? { body: Buffer.from(body).toString("base64") } : {}) };
        ws.send(JSON.stringify(response));
      }
    });
    ws.addEventListener("error", () => reject(new Error("websocket error")));
  });
  return ws;
}

describe("provider bridge", () => {
  test("relays an HTTP request to the provider and its response back", async () => {
    const ws = await connectFakeProvider(agent, req => ({ status: 200, body: JSON.stringify({ echoedPath: req.path, echoedMethod: req.method }) }));
    try {
      const res = await fetch(`${baseUrl}/p/${agent.accountId}/info?x=1`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ echoedPath: "/info?x=1", echoedMethod: "GET" });
    } finally {
      ws.close();
    }
  });

  test("forwards a POST body through", async () => {
    const ws = await connectFakeProvider(agent, req => ({ status: 202, body: JSON.stringify({ receivedPath: req.path, receivedBody: req.body ? Buffer.from(req.body, "base64").toString() : null }) }));
    try {
      const res = await fetch(`${baseUrl}/p/${agent.accountId}/jobs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jobType: "benchmark" }) });
      expect(res.status).toBe(202);
      expect(await res.json()).toEqual({ receivedPath: "/jobs", receivedBody: JSON.stringify({ jobType: "benchmark" }) });
    } finally {
      ws.close();
    }
  });

  test("503s when the claimed account isn't connected", async () => {
    const res = await fetch(`${baseUrl}/p/0.0.999999999/info`);
    expect(res.status).toBe(503);
  });

  test("a newer connection for the same account replaces the old one", async () => {
    const first = await connectFakeProvider(agent, () => ({ status: 200, body: "first" }));
    const firstClosed = new Promise<number>(resolve => first.addEventListener("close", e => resolve(e.code)));

    const second = await connectFakeProvider(agent, () => ({ status: 200, body: "second" }));
    expect(await firstClosed).toBe(4002);

    try {
      const res = await fetch(`${baseUrl}/p/${agent.accountId}/info`);
      expect(await res.text()).toBe("second");
    } finally {
      second.close();
    }
  });

  test("rejects a connection that can't prove the account it claims", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/connect`);
    const errorMessage = new Promise<string>((resolve, reject) => {
      ws.addEventListener("message", async event => {
        const frame = JSON.parse(event.data as string) as ServerFrame;
        if (frame.type === "challenge") {
          const hello: ClientFrame = { type: "hello", accountId: agent.accountId, providerId: "impostor", signature: Buffer.alloc(64).toString("base64") };
          ws.send(JSON.stringify(hello));
        } else if (frame.type === "error") {
          resolve(frame.message);
        } else if (frame.type === "ready") {
          reject(new Error("should not have been accepted"));
        }
      });
    });
    expect(await errorMessage).toContain(agent.accountId);
    ws.close();
  });
});
