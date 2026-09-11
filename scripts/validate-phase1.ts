/**
 * Phase 1 gate: the provider issues a 402 with the facilitator's fee payer, an agent-signed
 * payment passes /verify, and three paid GPU jobs complete back-to-back with real, distinct
 * on-chain settlements. Starts the job runner and provider if they aren't already running.
 */
import { decodePaymentRequiredHeader } from "@x402/core/http";
import {
  accountFromEnv,
  createFacilitatorClient,
  createPayingClient,
  fetchFacilitatorFeePayer,
  hbarToTinybars,
  paymentTransactionId,
} from "@decomp/hedera-x402";
import { runJob } from "@decomp/agent";
import { ensureServices, providerService, runnerService } from "./lib/services";

const PROVIDER_PORT = 4021;
const providerUrl = `http://127.0.0.1:${PROVIDER_PORT}`;
const job = { jobType: "benchmark", params: { duration_s: 3 } };
const maxTinybarsPerPayment = hbarToTinybars(1);

let failures = 0;
function record(name: string, ok: boolean, detail: string) {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name} — ${detail}`);
}
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

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
  record(
    "POST /jobs without payment returns 402 with the facilitator's feePayer",
    challenge.status === 402 && advertised === feePayer,
    `HTTP ${challenge.status}, requirements feePayer ${advertised}, /supported feePayer ${feePayer}`,
  );

  if (paymentRequired) {
    try {
      const agent = createPayingClient({ account: accountFromEnv("AGENT"), maxTinybarsPerPayment });
      const payload = await agent.createPayload(paymentRequired);
      const verify = await createFacilitatorClient().verify(payload, payload.accepted);
      record(
        "agent-signed TransferTransaction passes facilitator /verify",
        verify.isValid,
        `${paymentTransactionId(payload)} isValid=${verify.isValid}` +
          (verify.invalidReason ? ` ${verify.invalidReason}: ${verify.invalidMessage ?? ""}` : ""),
      );
    } catch (error) {
      record("agent-signed TransferTransaction passes facilitator /verify", false, message(error));
    }
  }

  const transactionIds: string[] = [];
  for (let run = 1; run <= 3; run++) {
    const name = `cycle ${run}: quote → pay → settle → GPU run → result, no manual steps`;
    try {
      const summary = await runJob({
        providerUrl,
        ...job,
        account: accountFromEnv("AGENT"),
        maxTinybarsPerPayment,
        log: line => console.log(`   [${run}] ${line}`),
      });
      const result = summary.result as { device?: string; iterations?: number } | undefined;
      const ranOnGpu = summary.status === "succeeded" && /gpu|mps/i.test(result?.device ?? "") && (result?.iterations ?? 0) > 0;
      const settled =
        summary.mirror?.length === summary.transactionIds.length &&
        summary.mirror.every(m => m.result === "SUCCESS" && BigInt(m.creditedTinybars) === BigInt(summary.amountTinybars));
      transactionIds.push(...summary.transactionIds);
      record(
        name,
        Boolean(ranOnGpu && settled),
        `tx ${summary.transactionIds.join(", ")} (${summary.mirror?.map(m => m.result).join(", ")}), ` +
          `${result?.device} ${result?.iterations} iterations`,
      );
    } catch (error) {
      record(name, false, message(error));
    }
  }
  record(
    "three cycles settled three distinct transactions",
    new Set(transactionIds).size === 3,
    transactionIds.join(" ") || "none",
  );
} finally {
  stop();
}

console.log(failures ? `\n${failures} check(s) failed — fix before Phase 2.` : "\nPhase 1 gate passed.");
process.exit(failures ? 1 : 0);
