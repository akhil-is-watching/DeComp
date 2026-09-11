import { describe, expect, test } from "bun:test";
import {
  REGISTRATION_SCHEMA,
  compareTimestamps,
  currentRegistrations,
  parseRegistration,
  type ProviderRegistration,
  type RegistryEntry,
} from "../src/registry";

const base: ProviderRegistration = {
  schema: REGISTRATION_SCHEMA,
  providerId: "PROVIDER_1",
  hederaAccount: "0.0.1001",
  endpoint: "http://127.0.0.1:4021",
  network: "hedera:testnet",
  jobTypes: [{ name: "benchmark", pricePerSecTinybars: "2000000", tickSeconds: 5 }],
  publishedAt: "2026-09-12T00:00:00.000Z",
};

function entry(overrides: Partial<RegistryEntry>): RegistryEntry {
  return { ...base, consensusTimestamp: "1789151420.000000001", sequenceNumber: 1, payerAccountId: base.hederaAccount, ...overrides };
}

const offer = (overrides: Record<string, unknown>) => ({ jobTypes: [{ name: "benchmark", pricePerSecTinybars: "1", tickSeconds: 5, ...overrides }] });

describe("parseRegistration", () => {
  test("accepts a well-formed registration", () => {
    expect(parseRegistration(base)).toEqual(base);
  });

  test.each([
    ["an older schema version", { schema: "decomp/provider-registration@1" }],
    ["a bad account id", { hederaAccount: "0xabc" }],
    ["a non-http endpoint", { endpoint: "file:///etc/passwd" }],
    ["no job types", { jobTypes: [] }],
    ["a zero price", offer({ pricePerSecTinybars: "0" })],
    ["a decimal price", offer({ pricePerSecTinybars: "0.5" })],
    ["a bad job type name", offer({ name: "Rm -rf" })],
    ["a zero-length tick", offer({ tickSeconds: 0 })],
    ["a fractional tick", offer({ tickSeconds: 1.5 })],
    ["a missing tick", offer({ tickSeconds: undefined })],
  ])("rejects %s", (_, overrides) => {
    expect(parseRegistration({ ...base, ...overrides })).toBeNull();
  });
});

test("compareTimestamps orders by seconds then nanoseconds", () => {
  expect(compareTimestamps("1789151420.9", "1789151421.0")).toBe(-1);
  expect(compareTimestamps("1789151420.000000010", "1789151420.000000002")).toBe(1);
  expect(compareTimestamps("1789151420.5", "1789151420.500000000")).toBe(0);
});

describe("currentRegistrations", () => {
  test("keeps only the newest registration per account", () => {
    const older = entry({ consensusTimestamp: "1789151420.1", ...offer({ pricePerSecTinybars: "5" }) });
    const newer = entry({ consensusTimestamp: "1789151500.1", sequenceNumber: 2 });
    expect(currentRegistrations([newer, older], "hedera:testnet")).toEqual([newer]);
  });

  test("ignores registrations paid for by a different account", () => {
    const spoofed = entry({ payerAccountId: "0.0.6666" });
    expect(currentRegistrations([spoofed], "hedera:testnet")).toEqual([]);
  });

  test("a spoofed newer message cannot replace a genuine one", () => {
    const genuine = entry({});
    const spoofed = entry({ consensusTimestamp: "1789159999.0", payerAccountId: "0.0.6666", endpoint: "http://evil.example" });
    expect(currentRegistrations([genuine, spoofed], "hedera:testnet")).toEqual([genuine]);
  });

  test("ignores other networks", () => {
    expect(currentRegistrations([entry({ network: "hedera:mainnet" })], "hedera:testnet")).toEqual([]);
  });
});
