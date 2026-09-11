import { expect, test } from "bun:test";
import { REGISTRATION_SCHEMA, type RegistryEntry } from "@decomp/hcs-registry";
import { offersFor } from "../src/discovery";

const NETWORK = "hedera:testnet";

function registration(account: string, jobTypes: [name: string, pricePerSec: string][], consensusTimestamp = "1789151420.0"): RegistryEntry {
  return {
    schema: REGISTRATION_SCHEMA,
    providerId: `provider-${account}`,
    hederaAccount: account,
    endpoint: `http://127.0.0.1:${4000 + Number(account.split(".")[2])}`,
    network: NETWORK,
    jobTypes: jobTypes.map(([name, pricePerSecTinybars]) => ({ name, pricePerSecTinybars, tickSeconds: 5 })),
    publishedAt: "2026-09-12T00:00:00.000Z",
    consensusTimestamp,
    sequenceNumber: 1,
    payerAccountId: account,
  };
}

const registry = [
  registration("0.0.21", [["benchmark", "2000000"]]),
  registration("0.0.22", [["benchmark", "1600000"], ["mandelbrot", "4000000"]]),
  registration("0.0.23", [["mandelbrot", "3000000"]]),
];

test("only providers offering the requested job type are candidates", () => {
  expect(offersFor(registry, "benchmark", NETWORK).map(c => c.hederaAccount).sort()).toEqual(["0.0.21", "0.0.22"]);
  expect(offersFor(registry, "mandelbrot", NETWORK).map(c => c.hederaAccount).sort()).toEqual(["0.0.22", "0.0.23"]);
  expect(offersFor(registry, "upscale", NETWORK)).toEqual([]);
});

test("each candidate is priced at its offer for the requested job type", () => {
  const prices = Object.fromEntries(offersFor(registry, "mandelbrot", NETWORK).map(c => [c.hederaAccount, c.pricePerSecTinybars]));
  expect(prices).toEqual({ "0.0.22": 4000000n, "0.0.23": 3000000n });
});

test("a provider that dropped a job type in its newest registration is no longer a candidate", () => {
  const updated = registration("0.0.22", [["mandelbrot", "4000000"]], "1789159999.0");
  expect(offersFor([...registry, updated], "benchmark", NETWORK).map(c => c.hederaAccount)).toEqual(["0.0.21"]);
});
