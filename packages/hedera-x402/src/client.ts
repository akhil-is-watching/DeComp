/**
 * Paying HTTP client for agents. Performs the x402 exchange step by step (rather than via
 * wrapFetchWithPayment) so every stage — challenge, signature, settlement — is observable.
 */
import { Transaction } from "@hiero-ledger/sdk";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import type { PaymentPayload, PaymentRequired, PaymentRequirements, SettleResponse } from "@x402/core/types";
import { createClientHederaSigner } from "@x402/hedera";
import { ExactHederaScheme } from "@x402/hedera/exact/client";
import { hederaNetwork, type HederaNetwork } from "./config";
import type { AccountCredentials } from "./keys";

export type PaymentEvent =
  | { type: "payment_required"; url: string; paymentRequired: PaymentRequired }
  | { type: "payment_signed"; requirements: PaymentRequirements; transactionId: string; payer: string }
  | { type: "payment_settled"; settlement: SettleResponse }
  | { type: "payment_rejected"; status: number; body: unknown };

export type AssetCap = {
  /** "0.0.0" for HBAR (amounts in tinybars) or an HTS token id (amounts in the token's smallest unit). */
  asset: string;
  /** Largest single payment the client will sign in this asset. */
  maxAmountPerPayment: bigint;
};

export type PayingClientOptions = {
  account: AccountCredentials;
  network?: HederaNetwork;
  /** Assets the client may pay with. The x402 client refuses anything else before signing. */
  allowedAssets: AssetCap[];
  /** When a 402 offers several assets, pay with this one; otherwise the first allowed asset offered. */
  preferredAsset?: string;
  onEvent?: (event: PaymentEvent) => void;
};

export type PaidResponse = {
  response: Response;
  body: unknown;
  /** Present when the server settled a payment for this request. */
  settlement?: SettleResponse;
};

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : undefined;
  } catch {
    return text;
  }
}

/** The Hedera transaction id inside an exact-scheme payload, e.g. `0.0.7162784@1700000000.123456789`. */
export function paymentTransactionId(payload: PaymentPayload): string {
  const { transaction } = payload.payload as { transaction: string };
  return Transaction.fromBytes(Buffer.from(transaction, "base64")).transactionId?.toString() ?? "unknown";
}

export function createPayingClient(options: PayingClientOptions) {
  const network = options.network ?? hederaNetwork();
  const signer = createClientHederaSigner(options.account.accountId, options.account.privateKey, { network });
  const allowed = new Set(options.allowedAssets.map(a => a.asset));
  const client = x402Client.fromConfig({
    schemes: [{ network, client: new ExactHederaScheme(signer) }],
    spendControls: {
      allowedAssets: options.allowedAssets.map(({ asset, maxAmountPerPayment }) => ({
        network,
        asset,
        maxAmountPerPayment: maxAmountPerPayment.toString(),
      })),
    },
    paymentRequirementsSelector: (_x402Version, accepts) =>
      accepts.find(r => r.asset === options.preferredAsset) ?? accepts.find(r => allowed.has(r.asset)) ?? accepts[0]!,
  });
  const http = new x402HTTPClient(client);
  const emit = options.onEvent ?? (() => {});

  async function request(
    url: string,
    init: RequestInit = {},
    hooks: {
      /** Runs on the 402 before anything is signed; throw to refuse the payment. */
      beforeSign?: (paymentRequired: PaymentRequired) => void | Promise<void>;
    } = {},
  ): Promise<PaidResponse> {
    const challenge = await fetch(url, init);
    const challengeBody = await readBody(challenge);
    if (challenge.status !== 402) {
      return { response: challenge, body: challengeBody };
    }

    const paymentRequired = http.getPaymentRequiredResponse(name => challenge.headers.get(name), challengeBody);
    emit({ type: "payment_required", url, paymentRequired });
    await hooks.beforeSign?.(paymentRequired);

    const payload = await http.createPaymentPayload(paymentRequired);
    emit({
      type: "payment_signed",
      requirements: payload.accepted,
      transactionId: paymentTransactionId(payload),
      payer: signer.accountId,
    });

    const headers = new Headers(init.headers);
    for (const [key, value] of Object.entries(http.encodePaymentSignatureHeader(payload))) {
      headers.set(key, value);
    }
    const paid = await fetch(url, { ...init, headers });
    const body = await readBody(paid);

    if (paid.headers.has("PAYMENT-RESPONSE")) {
      const settlement = http.getPaymentSettleResponse(name => paid.headers.get(name));
      emit(settlement.success ? { type: "payment_settled", settlement } : { type: "payment_rejected", status: paid.status, body });
      return { response: paid, body, settlement };
    }
    if (paid.status >= 400) {
      emit({ type: "payment_rejected", status: paid.status, body });
    }
    return { response: paid, body };
  }

  return {
    accountId: signer.accountId,
    network,
    request,
    /** Signs a payment for a challenge without sending it, e.g. to check it against /verify. */
    createPayload: (paymentRequired: PaymentRequired) => http.createPaymentPayload(paymentRequired),
  };
}

export type PayingClient = ReturnType<typeof createPayingClient>;
