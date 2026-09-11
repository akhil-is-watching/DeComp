import { describe, expect, test } from "bun:test";
import { AUDIT_SCHEMA, parseAudit, type JobAudit } from "../src/audit";

const audit: JobAudit = {
  schema: AUDIT_SCHEMA,
  jobId: "96b417da-49cc-41c7-9179-a3fab5e77f19",
  jobType: "mandelbrot",
  network: "hedera:testnet",
  provider: { id: "PROVIDER_1", account: "0.0.10481879", endpoint: "http://127.0.0.1:4021" },
  agent: "0.0.10481877",
  asset: "0.0.0",
  tickSeconds: 5,
  transactions: ["0.0.7162784@1789152917.726789395", "0.0.7162784@1789152923.314812425"],
  totalPaid: "10000000",
  wallClockS: 9.4,
  status: "succeeded",
  completedAt: "2026-09-12T00:00:00.000Z",
};

describe("parseAudit", () => {
  test("accepts a complete record", () => {
    expect(parseAudit(audit)).toEqual(audit);
  });

  test("accepts a record paid in an HTS token", () => {
    expect(parseAudit({ ...audit, asset: "0.0.5005" })?.asset).toBe("0.0.5005");
  });

  test.each([
    ["another schema", { schema: "decomp/job-audit@0" }],
    ["a missing provider account", { provider: { id: "PROVIDER_1", endpoint: "http://x" } }],
    ["a malformed transaction id", { transactions: ["0.0.7162784-1789152917-726789395"] }],
    ["a non-string transaction", { transactions: [42] }],
    ["a decimal total", { totalPaid: "0.1" }],
    ["a malformed agent account", { agent: "agent" }],
    ["a missing wall-clock time", { wallClockS: undefined }],
  ])("rejects %s", (_, overrides) => {
    expect(parseAudit({ ...audit, ...overrides })).toBeNull();
  });
});
