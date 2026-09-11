/**
 * Provider gate against the live Blocky402 facilitator. Needs no funded accounts: payTo is a
 * placeholder, and the only signed payment is deliberately invalid, so nothing ever settles.
 */
import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { PrivateKey } from "@hiero-ledger/sdk";
import { decodePaymentRequiredHeader } from "@x402/core/http";
import { createPayingClient, fetchFacilitatorFeePayer, hbarToTinybars } from "@decomp/hedera-x402";
import { ensureServices, providerService, runnerService } from "../../../scripts/lib/services";

const PORT = 4999;
const BASE = `http://127.0.0.1:${PORT}`;
const PAY_TO = "0.0.2";

// Service startup and facilitator round-trips are network-bound.
setDefaultTimeout(90_000);

let stop = () => {};
beforeAll(async () => {
  ({ stop } = await ensureServices([
    runnerService(),
    // No registry: this provider's payTo is a placeholder, so it must not advertise itself.
    providerService("PROVIDER_1", PORT, { PROVIDER_1_ACCOUNT_ID: PAY_TO, PROVIDER_OFFERS: "benchmark:10000000", REGISTRY_TOPIC_ID: "" }),
  ]));
});
afterAll(() => stop());

function postJob(body: unknown, headers: Record<string, string> = {}) {
  return fetch(`${BASE}/jobs`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

test("rejects unknown job types before quoting a price", async () => {
  const res = await postJob({ jobType: "mine-bitcoin" });
  expect(res.status).toBe(400);
  expect(res.headers.has("PAYMENT-REQUIRED")).toBe(false);
});

test("unpaid job request gets a 402 carrying the facilitator's fee payer", async () => {
  const res = await postJob({ jobType: "benchmark", params: { duration_s: 1 } });
  expect(res.status).toBe(402);

  const required = decodePaymentRequiredHeader(res.headers.get("PAYMENT-REQUIRED")!);
  const requirements = required.accepts[0]!;
  expect(requirements).toMatchObject({
    scheme: "exact",
    network: "hedera:testnet",
    asset: "0.0.0",
    amount: "10000000",
    payTo: PAY_TO,
  });
  expect(requirements.extra?.feePayer).toBe(await fetchFacilitatorFeePayer());
  // The JSON body mirrors the header so the requirements are readable without decoding.
  expect(await res.json()).toMatchObject({ x402Version: 2, accepts: [requirements] });
}, 30_000);

test("malformed payment header is treated as unpaid", async () => {
  const res = await postJob({ jobType: "benchmark" }, { "PAYMENT-SIGNATURE": "not-a-payment" });
  expect(res.status).toBe(402);
}, 30_000);

// The hosted facilitator's /verify accepts this; the provider's own signature check must not.
test("payment signed with the wrong key is rejected before any job starts", async () => {
  const impostor = createPayingClient({
    account: { accountId: "0.0.3", privateKey: PrivateKey.generateECDSA() },
    maxTinybarsPerPayment: hbarToTinybars(1),
  });
  const { response, body, settlement } = await impostor.request(`${BASE}/jobs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jobType: "benchmark", params: { duration_s: 1 } }),
  });
  expect(response.status).toBe(402);
  expect(settlement).toBeUndefined();
  expect(typeof (body as { error?: unknown }).error).toBe("string");
}, 60_000);

test("unknown job id is 404", async () => {
  const res = await fetch(`${BASE}/jobs/does-not-exist`);
  expect(res.status).toBe(404);
});
