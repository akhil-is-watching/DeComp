/**
 * Real integration test: signs with the live AGENT identity's actual Privy wallet and verifies
 * against what the mirror node reports for its account — no stub, since this is exactly the
 * "prove you control this account" property that matters, and it costs nothing to check for real
 * (one Privy signature, one mirror-node read).
 */
import { describe, expect, test } from "bun:test";
import { privyIdentity } from "@decomp/privy-hedera";
import { randomNonce, verifyHello } from "../src/auth";
import type { HelloFrame } from "../src/types";

describe("verifyHello", () => {
  test("accepts a signature from the account's real key", async () => {
    const agent = await privyIdentity("AGENT");
    const nonce = randomNonce();
    const signature = await agent.signMessage(Buffer.from(nonce, "base64"));
    const hello: HelloFrame = { type: "hello", accountId: agent.accountId, providerId: "test-provider", signature: Buffer.from(signature).toString("base64") };

    expect(await verifyHello(hello, nonce)).toEqual({ ok: true });
  });

  test("rejects a signature over a different nonce", async () => {
    const agent = await privyIdentity("AGENT");
    const nonce = randomNonce();
    const wrongNonce = randomNonce();
    const signature = await agent.signMessage(Buffer.from(wrongNonce, "base64"));
    const hello: HelloFrame = { type: "hello", accountId: agent.accountId, providerId: "test-provider", signature: Buffer.from(signature).toString("base64") };

    const result = await verifyHello(hello, nonce);
    expect(result.ok).toBe(false);
  });

  test("rejects a signature claiming the wrong account", async () => {
    const agent = await privyIdentity("AGENT");
    const nonce = randomNonce();
    const signature = await agent.signMessage(Buffer.from(nonce, "base64"));
    // Signed by AGENT, but claims to be OPERATOR.
    const hello: HelloFrame = { type: "hello", accountId: process.env.OPERATOR_ACCOUNT_ID!, providerId: "test-provider", signature: Buffer.from(signature).toString("base64") };

    const result = await verifyHello(hello, nonce);
    expect(result.ok).toBe(false);
  });

  test("rejects garbage signatures cleanly, without throwing", async () => {
    const hello: HelloFrame = { type: "hello", accountId: process.env.AGENT_ACCOUNT_ID!, providerId: "x", signature: "not-base64!!!" };
    const result = await verifyHello(hello, randomNonce());
    expect(result.ok).toBe(false);
  });

  test("rejects an unknown account", async () => {
    const hello: HelloFrame = { type: "hello", accountId: "0.0.999999999", providerId: "x", signature: Buffer.alloc(64).toString("base64") };
    const result = await verifyHello(hello, randomNonce());
    expect(result.ok).toBe(false);
  });
});
