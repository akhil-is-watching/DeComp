/**
 * Live provider connections and in-flight request/response correlation. Kept independent of
 * Bun.serve's WebSocket wiring (index.ts) so it's testable without a real socket.
 */
import type { RequestFrame, ResponseFrame } from "@decomp/bridge-protocol";

export type Sender = (frame: RequestFrame) => void;
export type Connection = { accountId: string; providerId: string; connectedAt: number; send: Sender; close: (reason: string) => void };

const connections = new Map<string, Connection>();

/** Returns the connection it replaced, if any — the caller closes that socket. */
export function registerConnection(accountId: string, providerId: string, send: Sender, close: (reason: string) => void): Connection | undefined {
  const replaced = connections.get(accountId);
  connections.set(accountId, { accountId, providerId, connectedAt: Date.now(), send, close });
  return replaced;
}

/** Only removes the entry if it's still this exact connection — a replaced one shouldn't be evicted by the old socket's close event. */
export function unregisterConnection(accountId: string, send: Sender): void {
  if (connections.get(accountId)?.send === send) connections.delete(accountId);
}

export function getConnection(accountId: string): Connection | undefined {
  return connections.get(accountId);
}

export function listConnections(): { accountId: string; providerId: string; connectedAt: number }[] {
  return [...connections.values()].map(({ accountId, providerId, connectedAt }) => ({ accountId, providerId, connectedAt }));
}

const REQUEST_TIMEOUT_MS = 30_000;
const pending = new Map<string, { resolve: (frame: ResponseFrame) => void }>();

/** Sends `frame` to the account's live connection and resolves with its correlated response, or rejects if unreachable/timed out. */
export function forwardRequest(accountId: string, frame: RequestFrame): Promise<ResponseFrame> {
  const conn = connections.get(accountId);
  if (!conn) return Promise.reject(new Error("not_connected"));

  return new Promise<ResponseFrame>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(frame.id);
      reject(new Error("timeout"));
    }, REQUEST_TIMEOUT_MS);
    pending.set(frame.id, { resolve: response => (clearTimeout(timer), pending.delete(frame.id), resolve(response)) });
    conn.send(frame);
  });
}

/** Called when a `response` frame arrives on some socket; resolves the matching forwardRequest call, if any. */
export function resolvePending(response: ResponseFrame): void {
  pending.get(response.id)?.resolve(response);
}
