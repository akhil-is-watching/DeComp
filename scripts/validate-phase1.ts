/**
 * Phase 1 gate: the provider issues a 402 with the facilitator's fee payer, an agent-signed
 * payment passes /verify, and three paid GPU jobs complete back-to-back with real, distinct
 * on-chain settlements. Every signature is made by the agent's Privy wallet.
 * Starts the job runner and provider if they aren't already running.
 */
import { decodePaymentRequiredHeader } from "@x402/core/http";
import {
  HBAR_ASSET,
  createFacilitatorClient,
  createPayingClient,
  fetchFacilitatorFeePayer,
  hbarToTinybars,
  paymentTransactionId,
} from "@decomp/hedera-x402";
import { privyIdentity } from "@decomp/privy-hedera";
import { runJob } from "@decomp/agent";
import { allPaymentsSettled, createGate, errorMessage } from "./lib/gate";
import { ensureServices, providerService, runnerService } from "./lib/services";

const PROVIDER_PORT = 4021;
const providerUrl = `http://127.0.0.1:${PROVIDER_PORT}`;
const job = { jobType: "benchmark", params: { duration_s: 3 } };
const maxAmountPerPayment = hbarToTinybars(1);
const gate = createGate(1);
const identity = await privyIdentity("AGENT");

const { stop } = await ensureServices([runnerService(), providerService("PROVIDER_1", PROVIDER_PORT)]);
try {
  const challenge = await fetch(`${providerUrl}/jobs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(job),
  });
  const header = challenge.headers.get("PAYMENT-REQUIRED");
  const paymentRequired = header ? decodePaymentRequiredHeader(header) : undefined;
  const advertised = paymentRequired?.accepts[0]?.extra?.feePayer;
  const feePayer = await fetchFacilitatorFeePayer();
  gate.record(
    "POST /jobs without payment returns 402 with the facilitator's feePayer",
    challenge.status === 402 && advertised === feePayer,
    `HTTP ${challenge.status}, requirements feePayer ${advertised}, /supported feePayer ${feePayer}`,
  );

  if (paymentRequired) {
    try {
      const agent = createPayingClient({
        signer: identity.paymentSigner,
        allowedAssets: [{ asset: HBAR_ASSET, maxAmountPerPayment }],
      });
      const payload = await agent.createPayload(paymentRequired);
      const verify = await createFacilitatorClient().verify(payload, payload.accepted);
      gate.record(
        "Privy-signed TransferTransaction passes facilitator /verify",
        verify.isValid,
        `${paymentTransactionId(payload)} signed by wallet ${identity.wallet.walletId}, isValid=${verify.isValid}` +
          (verify.invalidReason ? ` ${verify.invalidReason}: ${verify.invalidMessage ?? ""}` : ""),
      );
    } catch (error) {
      gate.record("Privy-signed TransferTransaction passes facilitator /verify", false, errorMessage(error));
    }
  }

  const transactionIds: string[] = [];
  for (let run = 1; run <= 3; run++) {
    const name = `cycle ${run}: quote → pay → settle → GPU run → result, no manual steps`;
    try {
      const summary = await runJob({
        providerUrl,
        ...job,
        identity,
        maxAmountPerPayment,
        log: line => console.log(`   [${run}] ${line}`),
      });
      const result = summary.result as { device?: string; iterations?: number } | undefined;
      const ranOnGpu = summary.status === "succeeded" && /gpu|mps/i.test(result?.device ?? "") && (result?.iterations ?? 0) > 0;
      transactionIds.push(...summary.payments.map(p => p.transactionId));
      gate.record(
        name,
        ranOnGpu && allPaymentsSettled(summary),
        `${summary.payments.map(p => `${p.transactionId} (${p.mirror?.result})`).join(", ")}, ` +
          `${result?.device} ${result?.iterations} iterations`,
      );
    } catch (error) {
      gate.record(name, false, errorMessage(error));
    }
  }
  gate.record(
    "every settlement across the three cycles is a distinct transaction",
    transactionIds.length >= 3 && new Set(transactionIds).size === transactionIds.length,
    transactionIds.join(" ") || "none",
  );
} finally {
  stop();
}
gate.finish();
