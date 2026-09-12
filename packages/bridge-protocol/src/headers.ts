/**
 * Which headers cross the bridge, in both directions. An allowlist of "the ones x402 needs" broke
 * the moment the actual payment headers (PAYMENT-REQUIRED, PAYMENT-SIGNATURE, PAYMENT-RESPONSE)
 * turned out not to be content-type — a blocklist of hop-by-hop headers is both correct now and
 * future-proof against whatever header a provider API adds next.
 */
const HOP_BY_HOP = new Set(["host", "connection", "content-length", "transfer-encoding", "keep-alive", "upgrade", "te", "trailer", "proxy-authenticate", "proxy-authorization"]);

export function forwardableHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) result[key] = value;
  });
  return result;
}
