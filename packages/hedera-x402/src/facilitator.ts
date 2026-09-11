import { HTTPFacilitatorClient, x402ResourceServer, type AfterVerifyHook } from "@x402/core/server";
import {
  createHederaVerifyPayerSignature,
  extractTransactionFromPayload,
  inspectHederaTransaction,
  type ExactHederaPayloadV2,
} from "@x402/hedera";
import { ExactHederaScheme } from "@x402/hedera/exact/server";
import { HBAR_ASSET, networkConfig, type HederaNetwork } from "./config";

export type SupportedKind = { x402Version: number; scheme: string; network: string; extra?: { feePayer?: string } };

export function createFacilitatorClient(network?: HederaNetwork): HTTPFacilitatorClient {
  return new HTTPFacilitatorClient({ url: networkConfig(network).facilitatorUrl });
}

/**
 * Rejects payments not signed by every debited account.
 *
 * Blocky402's hosted testnet /verify returned `isValid: true` for transfers signed with the wrong
 * key (checked 2026-09-11); they only fail at settlement with INVALID_SIGNATURE. Without this
 * check a forged payment would start paid work before settlement could catch it.
 */
export function requirePayerSignatures(): AfterVerifyHook {
  const verifyPayerSignature = createHederaVerifyPayerSignature();
  return async ({ paymentPayload, requirements, result }) => {
    if (!result.isValid) return;
    const transaction = extractTransactionFromPayload(paymentPayload.payload as unknown as ExactHederaPayloadV2);
    const inspected = inspectHederaTransaction(transaction);
    const transfers =
      requirements.asset === HBAR_ASSET ? inspected.hbarTransfers : (inspected.tokenTransfers[requirements.asset] ?? []);
    const payers = [...new Set(transfers.filter(t => BigInt(t.amount) < 0n).map(t => t.accountId))];
    if (payers.length === 0) {
      return { abort: true, reason: "invalid_payer_signature", message: "payment debits no account" };
    }
    for (const payer of payers) {
      const check = await verifyPayerSignature({ payer, transaction, network: requirements.network });
      if (!check.ok) {
        return { abort: true, reason: "invalid_payer_signature", message: check.message ?? `${payer} did not sign` };
      }
    }
  };
}

/** A resource server that prices in Hedera assets and delegates verify/settle to Blocky402. */
export function createResourceServer(network?: HederaNetwork): x402ResourceServer {
  const { network: resolved } = networkConfig(network);
  return new x402ResourceServer(createFacilitatorClient(resolved))
    .register(resolved, new ExactHederaScheme())
    .onAfterVerify(requirePayerSignatures());
}

/** The fee payer account the facilitator currently advertises for exact payments on this network. */
export async function fetchFacilitatorFeePayer(network?: HederaNetwork): Promise<string> {
  const { network: resolved, facilitatorUrl } = networkConfig(network);
  const res = await fetch(`${facilitatorUrl}/supported`, { signal: AbortSignal.timeout(15_000) });
  const { kinds } = (await res.json()) as { kinds: SupportedKind[] };
  const feePayer = kinds.find(k => k.network === resolved && k.scheme === "exact")?.extra?.feePayer;
  if (!feePayer) {
    throw new Error(`Facilitator ${facilitatorUrl} does not advertise exact payments on ${resolved}`);
  }
  return feePayer;
}
