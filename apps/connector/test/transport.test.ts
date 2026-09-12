/**
 * The /mcp transport end to end: auth, initialize, tools/list, and a couple of tool calls that
 * need no payment. Uses a test DID pre-cached against the real, existing AGENT wallet/account (see
 * flow.test.ts), so the one real network call made here is a read-only balance/registry lookup.
 */
import { describe, expect, test } from "bun:test";
import { putUser } from "../src/db";
import { mintAccessToken } from "../src/oauth/tokens";
import { deleteMcpSession, handleMcpRequest } from "../src/mcp/transport";

async function bearerFor(did: string): Promise<string> {
  const { token } = await mintAccessToken({ sub: did, client_id: "test-client" });
  return token;
}

function rpc(method: string, params?: unknown, id: unknown = 1) {
  return { jsonrpc: "2.0", id, method, ...(params !== undefined ? { params } : {}) };
}

async function post(body: unknown, token?: string): Promise<Response> {
  return handleMcpRequest(
    new Request("http://x/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    }),
  );
}

describe("auth", () => {
  test("no bearer token is rejected with the spec's 401 shape", async () => {
    const res = await post(rpc("tools/list"));
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain("resource_metadata=");
    expect(res.headers.get("www-authenticate")).toContain("/.well-known/oauth-protected-resource");
  });

  test("a garbage bearer token is rejected", async () => {
    const res = await post(rpc("tools/list"), "not-a-real-token");
    expect(res.status).toBe(401);
  });
});

describe("initialize", () => {
  test("returns a session id header and negotiates the requested protocol version", async () => {
    const did = `did:privy:test-${crypto.randomUUID()}`;
    putUser(did, process.env.AGENT_WALLET_ID!, process.env.AGENT_ACCOUNT_ID!);
    const res = await post(rpc("initialize", { protocolVersion: "2025-06-18" }), await bearerFor(did));
    expect(res.status).toBe(200);
    const sessionId = res.headers.get("mcp-session-id");
    expect(sessionId).toBeTruthy();
    const body = (await res.json()) as { result: { protocolVersion: string; serverInfo: { name: string } } };
    expect(body.result.protocolVersion).toBe("2025-06-18");
    expect(body.result.serverInfo.name).toBe("decomp-connector");
    deleteMcpSession(new Request("http://x/mcp", { headers: { "mcp-session-id": sessionId! } }));
  });

  test("falls back to the latest protocol version when the client's isn't supported", async () => {
    const did = `did:privy:test-${crypto.randomUUID()}`;
    putUser(did, process.env.AGENT_WALLET_ID!, process.env.AGENT_ACCOUNT_ID!);
    const res = await post(rpc("initialize", { protocolVersion: "1999-01-01" }), await bearerFor(did));
    const body = (await res.json()) as { result: { protocolVersion: string } };
    expect(body.result.protocolVersion).not.toBe("1999-01-01");
  });
});

describe("tools/list", () => {
  test("lists all four tools", async () => {
    const did = `did:privy:test-${crypto.randomUUID()}`;
    putUser(did, process.env.AGENT_WALLET_ID!, process.env.AGENT_ACCOUNT_ID!);
    const res = await post(rpc("tools/list"), await bearerFor(did));
    const body = (await res.json()) as { result: { tools: { name: string }[] } };
    expect(body.result.tools.map(t => t.name).sort()).toEqual(["get_job_history", "get_wallet_balance", "list_providers", "run_gpu_job"]);
  });
});

describe("tools/call", () => {
  test("get_wallet_balance reports the caller's own account", async () => {
    const did = `did:privy:test-${crypto.randomUUID()}`;
    putUser(did, process.env.AGENT_WALLET_ID!, process.env.AGENT_ACCOUNT_ID!);
    const res = await post(rpc("tools/call", { name: "get_wallet_balance", arguments: {} }), await bearerFor(did));
    const body = (await res.json()) as { result: { content: { type: string; text?: string }[] } };
    expect(body.result.content[0]!.text).toContain(process.env.AGENT_ACCOUNT_ID!);
  });

  test("run_gpu_job rejects an out-of-range param before touching any provider", async () => {
    const did = `did:privy:test-${crypto.randomUUID()}`;
    putUser(did, process.env.AGENT_WALLET_ID!, process.env.AGENT_ACCOUNT_ID!);
    const res = await post(
      rpc("tools/call", { name: "run_gpu_job", arguments: { jobType: "mandelbrot", params: { width: 999999 } } }),
      await bearerFor(did),
    );
    const body = (await res.json()) as { result: { content: { type: string; text?: string }[]; isError?: boolean } };
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0]!.text).toContain("between 64 and 4096");
  });
});

test("an unknown method is a JSON-RPC method-not-found error", async () => {
  const did = `did:privy:test-${crypto.randomUUID()}`;
  putUser(did, process.env.AGENT_WALLET_ID!, process.env.AGENT_ACCOUNT_ID!);
  const res = await post(rpc("not/a/real/method"), await bearerFor(did));
  const body = (await res.json()) as { error: { code: number } };
  expect(body.error.code).toBe(-32601);
});
