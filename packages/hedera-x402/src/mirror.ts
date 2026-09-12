import { PublicKey } from "@hiero-ledger/sdk";
import { HBAR_ASSET, networkConfig, type HederaNetwork } from "./config";

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

/** The account's balance of an HTS token in smallest units, or null when it isn't associated. */
export async function getTokenBalance(accountId: string, tokenId: string, network?: HederaNetwork): Promise<bigint | null> {
  const res = await mirrorGet<{ tokens: { token_id: string; balance: number }[] }>(
    `/api/v1/accounts/${accountId}/tokens?token.id=${tokenId}`,
    network,
  ).catch(error => {
    // A just-created account isn't on the mirror node yet, which reads the same as unassociated.
    if (error instanceof Error && error.message.includes("Mirror node 404")) return { tokens: [] };
    throw error;
  });
  const row = res.tokens.find(t => t.token_id === tokenId);
  return row ? BigInt(row.balance) : null;
}

export async function isTokenAssociated(accountId: string, tokenId: string, network?: HederaNetwork): Promise<boolean> {
  return (await getTokenBalance(accountId, tokenId, network)) !== null;
}

/**
 * The account's single (non-key-list) public key from the mirror node, or null for an account
 * with no simple key or one this project doesn't sign with (only ECDSA/secp256k1 accounts do,
 * same as every Privy-backed identity elsewhere in this project).
 */
export async function getAccountPublicKey(accountId: string, network?: HederaNetwork): Promise<PublicKey | null> {
  const account = await mirrorGet<{ key: { _type: string; key: string } | null }>(`/api/v1/accounts/${accountId}`, network);
  if (account.key?._type !== "ECDSA_SECP256K1") return null;
  return PublicKey.fromStringECDSA(account.key.key);
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
  token_transfers?: (MirrorTransfer & { token_id: string })[];
};

/** Net amount of `asset` ("0.0.0" for HBAR, or an HTS token id) the transaction moved into `account`. */
export function creditedAmount(tx: MirrorTransaction, account: string, asset: string): bigint {
  const rows = asset === HBAR_ASSET ? tx.transfers : (tx.token_transfers ?? []).filter(t => t.token_id === asset);
  return rows.filter(t => t.account === account).reduce((sum, t) => sum + BigInt(t.amount), 0n);
}

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
