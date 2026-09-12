import { describe, expect, test } from "bun:test";
import { forwardableHeaders } from "../src/headers";

describe("forwardableHeaders", () => {
  test("passes through ordinary and x402 headers", () => {
    const headers = new Headers({ "content-type": "application/json", "payment-required": "abc", "payment-signature": "def", "x-custom": "1" });
    expect(forwardableHeaders(headers)).toEqual({ "content-type": "application/json", "payment-required": "abc", "payment-signature": "def", "x-custom": "1" });
  });

  test("strips hop-by-hop headers", () => {
    const headers = new Headers({ host: "example.com", connection: "keep-alive", "content-length": "42", "transfer-encoding": "chunked", "content-type": "text/plain" });
    expect(forwardableHeaders(headers)).toEqual({ "content-type": "text/plain" });
  });

  test("an empty header set forwards nothing", () => {
    expect(forwardableHeaders(new Headers())).toEqual({});
  });
});
