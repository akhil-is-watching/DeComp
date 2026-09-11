import {
  AccountId,
  ReceiptStatusError,
  Status,
  StatusError,
  TokenAssociateTransaction,
  TokenId,
  type Client,
} from "@hiero-ledger/sdk";
import type { AccountCredentials } from "./keys";
import { isTokenAssociated } from "./mirror";

/**
 * Associates an account with the HTS tokens it isn't associated with yet and returns the ones it
 * associated. Pass `knownUnassociated` for accounts created moments ago, since the mirror node
 * lags consensus. An account must be associated with a token before it can send or receive it.
 */
export async function associateTokens(
  client: Client,
  account: AccountCredentials,
  tokenIds: string[],
  { knownUnassociated = false }: { knownUnassociated?: boolean } = {},
): Promise<string[]> {
  const pending: string[] = [];
  for (const tokenId of tokenIds) {
    if (knownUnassociated || !(await isTokenAssociated(account.accountId, tokenId))) {
      pending.push(tokenId);
    }
  }
  if (pending.length === 0) return [];

  try {
    const tx = await new TokenAssociateTransaction()
      .setAccountId(AccountId.fromString(account.accountId))
      .setTokenIds(pending.map(id => TokenId.fromString(id)))
      .freezeWith(client)
      .sign(account.privateKey);
    await (await tx.execute(client)).getReceipt(client);
    return pending;
  } catch (error) {
    const status = error instanceof ReceiptStatusError || error instanceof StatusError ? error.status : undefined;
    if (status === Status.TokenAlreadyAssociatedToAccount) return [];
    throw error;
  }
}
