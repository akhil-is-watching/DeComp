/**
 * x402 payment gate for Bun.serve, following the same verify → handle → settle sequence as
 * the official Hono/Express middleware, but returning the settlement outcome to the caller so
 * paid work can be rolled back when settlement fails.
 */
import { decodePaymentRequiredHeader } from "@x402/core/http";
import {
  FacilitatorResponseError,
  SETTLEMENT_OVERRIDES_HEADER,
  withPrivateCacheControl,
  type HTTPAdapter,
  type HTTPRequestContext,
  type HTTPResponseInstructions,
  type x402HTTPResourceServer,
} from "@x402/core/server";
import type { PaymentPayload, PaymentRequirements, SettleResponse } from "@x402/core/types";

class BunRequestAdapter implements HTTPAdapter {
  private readonly url: URL;

  constructor(
    private readonly req: Request,
    private readonly body: unknown,
  ) {
    this.url = new URL(req.url);
  }

  getHeader(name: string) {
    return this.req.headers.get(name) ?? undefined;
  }
  getMethod() {
    return this.req.method;
  }
  getPath() {
    return this.url.pathname;
  }
  getUrl() {
    return this.req.url;
  }
  getAcceptHeader() {
    return this.req.headers.get("accept") ?? "";
  }
  getUserAgent() {
    return this.req.headers.get("user-agent") ?? "";
  }
  getQueryParams() {
    return Object.fromEntries(this.url.searchParams);
  }
  getQueryParam(name: string) {
    return this.url.searchParams.get(name) ?? undefined;
  }
  getBody() {
    return this.body;
  }
}

export type VerifiedPayment = { payload: PaymentPayload; requirements: PaymentRequirements };

export type GateOutcome =
  /** Route has no payment configured; handler ran without payment. */
  | { kind: "free"; response: Response }
  /** No payment, invalid payment, or facilitator failure; handler did not run. */
  | { kind: "rejected"; response: Response }
  /** Payment verified but handler returned >= 400, so nothing was settled. */
  | { kind: "handler_failed"; response: Response }
  | { kind: "settled"; response: Response; settlement: SettleResponse }
  /** Handler ran but settlement failed; the caller must undo any paid work. */
  | { kind: "settle_failed"; response: Response; errorReason: string };

function toResponse(instructions: HTTPResponseInstructions): Response {
  const headers = new Headers(instructions.headers);
  let body = instructions.body;
  // v2 carries PaymentRequired in a base64 header; mirror it into the JSON body so humans and
  // simple clients can read the requirements without decoding.
  const encoded = headers.get("PAYMENT-REQUIRED");
  const isEmptyObject = body && typeof body === "object" && Object.keys(body).length === 0;
  if (encoded && !instructions.isHtml && (body === undefined || isEmptyObject)) {
    body = decodePaymentRequiredHeader(encoded);
  }
  if (instructions.isHtml) {
    return new Response(String(body ?? ""), { status: instructions.status, headers });
  }
  headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify(body ?? {}), { status: instructions.status, headers });
}

function jsonError(status: number, error: string): Response {
  return Response.json({ error }, { status });
}

export function createPaymentGate(httpServer: x402HTTPResourceServer) {
  let initPromise: Promise<void> | null = null;

  async function ensureInitialized() {
    initPromise ??= httpServer.initialize();
    try {
      await initPromise;
    } catch (error) {
      initPromise = null; // allow a retry on the next request, e.g. after a facilitator timeout
      throw error;
    }
  }

  return async function gate(
    req: Request,
    body: unknown,
    handler: (payment: VerifiedPayment | null) => Promise<Response>,
  ): Promise<GateOutcome> {
    const adapter = new BunRequestAdapter(req, body);
    const context: HTTPRequestContext = {
      adapter,
      path: adapter.getPath(),
      method: req.method,
      paymentHeader: adapter.getHeader("payment-signature") ?? adapter.getHeader("x-payment"),
    };

    if (!httpServer.requiresPayment(context)) {
      return { kind: "free", response: await handler(null) };
    }

    let result: Awaited<ReturnType<x402HTTPResourceServer["processHTTPRequest"]>>;
    try {
      await ensureInitialized();
      result = await httpServer.processHTTPRequest(context);
    } catch (error) {
      console.error("[x402] facilitator error before handler:", error);
      const status = error instanceof FacilitatorResponseError ? 502 : 500;
      return { kind: "rejected", response: jsonError(status, error instanceof Error ? error.message : "payment error") };
    }

    if (result.type === "no-payment-required") {
      return { kind: "free", response: await handler(null) };
    }
    if (result.type === "payment-error") {
      return { kind: "rejected", response: toResponse(result.response) };
    }

    const { cancellationDispatcher, beforeHandlerSettlement, paymentPayload, paymentRequirements, declaredExtensions } =
      result;

    let handlerResponse: Response;
    try {
      handlerResponse = await handler({ payload: paymentPayload, requirements: paymentRequirements });
    } catch (error) {
      await cancellationDispatcher.cancel({ reason: "handler_threw", error });
      console.error("[x402] paid handler threw:", error);
      return { kind: "handler_failed", response: jsonError(500, "Internal Server Error") };
    }

    if (handlerResponse.status >= 400) {
      await cancellationDispatcher.cancel({ reason: "handler_failed", responseStatus: handlerResponse.status });
      return { kind: "handler_failed", response: handlerResponse };
    }

    const responseBody = Buffer.from(await handlerResponse.arrayBuffer());
    const responseHeaders: Record<string, string> = {};
    handlerResponse.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    try {
      const settle = await httpServer.processSettlement(
        paymentPayload,
        paymentRequirements,
        declaredExtensions,
        { request: context, responseBody, responseHeaders },
        undefined,
        beforeHandlerSettlement,
      );
      if (!settle.success) {
        return { kind: "settle_failed", response: toResponse(settle.response), errorReason: settle.errorReason };
      }

      const headers = new Headers(handlerResponse.headers);
      headers.delete(SETTLEMENT_OVERRIDES_HEADER);
      for (const [key, value] of Object.entries(settle.headers)) {
        headers.set(key, value);
      }
      headers.set("Cache-Control", withPrivateCacheControl(headers.get("Cache-Control")));
      const { headers: _, requirements: __, ...settlement } = settle;
      return {
        kind: "settled",
        response: new Response(responseBody, { status: handlerResponse.status, headers }),
        settlement,
      };
    } catch (error) {
      console.error("[x402] settlement error:", error);
      const status = error instanceof FacilitatorResponseError ? 502 : 402;
      return {
        kind: "settle_failed",
        response: jsonError(status, error instanceof Error ? error.message : "settlement failed"),
        errorReason: "settlement_exception",
      };
    }
  };
}
