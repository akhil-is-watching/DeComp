import { describe, expect, test } from "bun:test";
import { registerProviderForSigner, type RegistrationRequest } from "../src/main/provider-registration";

const VALID: RegistrationRequest = {
  registryTopicId: "0.0.10490097",
  accountId: "0.0.10519925",
  address: "0x8f2A5c1E9b47D3a6F0c8B21d4E7a9C3b5D6e1F02",
  providerId: "naruto11",
  endpoint: "https://bridge.decomp.cloud/p/0.0.10519925",
  jobTypes: [{ name: "benchmark", pricePerSecTinybars: "1250000", tickSeconds: 5 }],
  network: "hedera:testnet",
};

/** Never reached: every case here must be rejected before anything asks for a signature. */
const refuseToSign = () => {
  throw new Error("validation should have failed before signing");
};

/**
 * The registry silently drops a malformed message — parseRegistration returns null and the node
 * just never appears. These assertions keep the failure loud and local instead.
 */
describe("registration validation", () => {
  const cases: [string, Partial<RegistrationRequest>, string][] = [
    ["a non-account id", { accountId: "naruto11" }, "not a Hedera account id"],
    ["a missing topic", { registryTopicId: "" }, "no registry topic"],
    ["an empty name", { providerId: "" }, "1–64 characters"],
    ["an over-long name", { providerId: "x".repeat(65) }, "1–64 characters"],
    ["a non-http endpoint", { endpoint: "wss://bridge.decomp.cloud" }, "not an http(s) endpoint"],
    ["no job types", { jobTypes: [] }, "at least one job type"],
    ["an uppercase job type", { jobTypes: [{ name: "Benchmark", pricePerSecTinybars: "1", tickSeconds: 5 }] }, "not a valid job type"],
    ["a zero price", { jobTypes: [{ name: "benchmark", pricePerSecTinybars: "0", tickSeconds: 5 }] }, "price above zero"],
    ["a tick out of range", { jobTypes: [{ name: "benchmark", pricePerSecTinybars: "1", tickSeconds: 0 }] }, "1–3600 seconds"],
  ];

  for (const [label, patch, message] of cases) {
    test(`rejects ${label}`, async () => {
      await expect(registerProviderForSigner(refuseToSign, { ...VALID, ...patch })).rejects.toThrow(message);
    });
  }
});
