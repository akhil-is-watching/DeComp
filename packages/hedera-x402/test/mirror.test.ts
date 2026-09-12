import { describe, expect, test } from "bun:test";
import { getAccountPublicKey } from "../src/mirror";

describe("getAccountPublicKey", () => {
  test("resolves a real ECDSA account's public key from the mirror node", async () => {
    const accountId = process.env.OPERATOR_ACCOUNT_ID!;
    const key = await getAccountPublicKey(accountId);
    expect(key).not.toBeNull();
    expect(key!.toStringRaw()).toMatch(/^[0-9a-f]{66}$/); // compressed secp256k1, 33 bytes hex
  });

  test("a nonexistent account 404s, same as every other mirror lookup", async () => {
    await expect(getAccountPublicKey("0.0.999999999")).rejects.toThrow("Mirror node 404");
  });
});
