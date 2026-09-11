import { networkConfig, type HederaNetwork } from "./config";

export async function mirrorGet<T>(path: string, network?: HederaNetwork): Promise<T> {
  const url = `${networkConfig(network).mirrorNodeUrl}${path}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) {
    throw new Error(`Mirror node ${res.status} for ${path}: ${await res.text()}`);
  }
  return (await res.json()) as T;
}

export async function getHbarBalance(accountId: string, network?: HederaNetwork): Promise<bigint> {
  const account = await mirrorGet<{ balance: { balance: number } }>(`/api/v1/accounts/${accountId}`, network);
  return BigInt(account.balance.balance);
}

export async function isTokenAssociated(accountId: string, tokenId: string, network?: HederaNetwork): Promise<boolean> {
  const res = await mirrorGet<{ tokens: { token_id: string }[] }>(
    `/api/v1/accounts/${accountId}/tokens?token.id=${tokenId}`,
    network,
  );
  return res.tokens.some(t => t.token_id === tokenId);
}

/** SDK transaction ids look like `0.0.123@1700000000.000000001`; the mirror node wants `0.0.123-1700000000-000000001`. */
export function toMirrorTransactionId(transactionId: string): string {
  const [account, timestamp] = transactionId.split("@");
  if (!account || !timestamp) {
    throw new Error(`Unrecognized transaction id ${transactionId}`);
  }
  return `${account}-${timestamp.replace(".", "-")}`;
}

export type MirrorTransfer = { account: string; amount: number; is_approval: boolean };
export type MirrorTransaction = {
  transaction_id: string;
  consensus_timestamp: string;
  result: string;
  name: string;
  transfers: MirrorTransfer[];
  token_transfers: (MirrorTransfer & { token_id: string })[];
};

/** Polls until the mirror node has ingested the transaction (typically 3–6s after consensus). */
export async function waitForMirrorTransaction(
  transactionId: string,
  { network, timeoutMs = 30_000 }: { network?: HederaNetwork; timeoutMs?: number } = {},
): Promise<MirrorTransaction> {
  const id = toMirrorTransactionId(transactionId);
  const deadline = Date.now() + timeoutMs;
  while (true) {
    try {
      const res = await mirrorGet<{ transactions: MirrorTransaction[] }>(`/api/v1/transactions/${id}`, network);
      const tx = res.transactions[0];
      if (tx) return tx;
    } catch (error) {
      if (Date.now() > deadline) throw error;
    }
    if (Date.now() > deadline) {
      throw new Error(`Transaction ${transactionId} not visible on mirror node after ${timeoutMs}ms`);
    }
    await Bun.sleep(1_000);
  }
}
