/**
 * The provider side of the bridge, end to end: a real bridge server (apps/bridge), a real
 * connectBridge client authenticating as the real AGENT identity, and a stub HTTP server standing
 * in for the provider's own API. No mocks on the wire — this is the same two pieces that talk to
 * each other in production, just both running in this process.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { privyIdentity, type HederaIdentity } from "@decomp/privy-hedera";
import { createBridgeServer } from "../../bridge/src/server";
import { connectBridge } from "../src/bridge-client";

let bridge: ReturnType<typeof createBridgeServer>;
let stub: ReturnType<typeof Bun.serve>;
let agent: HederaIdentity;
let bridgeBaseUrl: string;

beforeAll(async () => {
  bridge = createBridgeServer(0);
  bridgeBaseUrl = `http://127.0.0.1:${bridge.port}`;
  agent = await privyIdentity("AGENT");

  stub = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/info") return Response.json({ name: "STUB_PROVIDER" });
      if (url.pathname === "/jobs" && req.method === "POST") {
        const body = (await req.json()) as { jobType?: string };
        return Response.json({ jobId: "job-1", received: body.jobType }, { status: 202 });
      }
      return Response.json({ error: "not found" }, { status: 404 });
    },
  });

  const connected = new Promise<void>(resolve => {
    connectBridge(bridgeBaseUrl, agent, "test-provider", stub.port!, line => {
      if (line.includes("bridge connected")) resolve();
    });
  });
  await connected;
});

afterAll(async () => {
  await Promise.race([bridge.stop(true), Bun.sleep(2000)]);
  stub.stop(true);
});

describe("connectBridge", () => {
  test("relays GET /info to the provider's own server", async () => {
    const res = await fetch(`${bridgeBaseUrl}/p/${agent.accountId}/info`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ name: "STUB_PROVIDER" });
  });

  test("relays POST /jobs with a body and returns the provider's status code", async () => {
    const res = await fetch(`${bridgeBaseUrl}/p/${agent.accountId}/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jobType: "benchmark" }),
    });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ jobId: "job-1", received: "benchmark" });
  });

  test("a path the stub doesn't have relays through as a real 404", async () => {
    const res = await fetch(`${bridgeBaseUrl}/p/${agent.accountId}/nonexistent`);
    expect(res.status).toBe(404);
  });
});
