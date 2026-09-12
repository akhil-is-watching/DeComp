/**
 * The frame shapes exchanged over a provider's persistent WebSocket connection to the bridge.
 * JSON text frames; binary bodies travel as base64 (`body`).
 *
 * Server → client: challenge the connection, then relay inbound HTTP requests to it.
 * Client → server: answer the challenge, then relay that request's response back.
 */

export type ChallengeFrame = { type: "challenge"; nonce: string };
export type ReadyFrame = { type: "ready" };
export type ErrorFrame = { type: "error"; message: string };
export type RequestFrame = { type: "request"; id: string; method: string; path: string; headers: Record<string, string>; body?: string };
export type ServerFrame = ChallengeFrame | ReadyFrame | ErrorFrame | RequestFrame;

/** Proves control of `accountId`: `signature` is over `nonce`'s raw bytes, via that account's key. */
export type HelloFrame = { type: "hello"; accountId: string; providerId: string; signature: string };
export type ResponseFrame = { type: "response"; id: string; status: number; headers: Record<string, string>; body?: string };
export type ClientFrame = HelloFrame | ResponseFrame;

export function parseServerFrame(raw: string): ServerFrame | undefined {
  try {
    const frame = JSON.parse(raw) as { type?: unknown };
    if (typeof frame.type !== "string") return undefined;
    return frame as ServerFrame;
  } catch {
    return undefined;
  }
}

export function parseClientFrame(raw: string): ClientFrame | undefined {
  try {
    const frame = JSON.parse(raw) as { type?: unknown };
    if (typeof frame.type !== "string") return undefined;
    return frame as ClientFrame;
  } catch {
    return undefined;
  }
}
