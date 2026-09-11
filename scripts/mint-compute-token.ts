/**
 * Mints the DeComp Compute Credit (DCC), an HTS fungible token agents can pay providers with
 * instead of HBAR. Associates the agent and every provider with it and tops up the agent's
 * balance. Safe to re-run: an existing COMPUTE_TOKEN_ID is reused.
 */
import { AccountId, TokenCreateTransaction, TokenId, TokenSupplyType, TokenType, TransferTransaction } from "@hiero-ledger/sdk";
import {
  accountFromEnv,
  associateTokens,
  getTokenBalance,
  mirrorGet,
  networkConfig,
  parsePrivateKey,
  requireEnv,
  sdkClient,
} from "@decomp/hedera-x402";
import { upsertEnv } from "./lib/env-file";

const DECIMALS = 2;
const UNIT = 10n ** BigInt(DECIMALS);
const INITIAL_SUPPLY = 1_000_000n * UNIT;
const AGENT_TARGET_BALANCE = 10_000n * UNIT;
const ROLES = ["AGENT", "PROVIDER_1", "PROVIDER_2", "PROVIDER_3"];

const formatDcc = (units: bigint) => `${units / UNIT}.${(units % UNIT).toString().padStart(DECIMALS, "0")} DCC`;

const { hashscan } = networkConfig();
const operator = { accountId: requireEnv("OPERATOR_ID"), privateKey: parsePrivateKey(requireEnv("OPERATOR_KEY")) };
const client = sdkClient(operator);

try {
  let tokenId = process.env.COMPUTE_TOKEN_ID;
  const existing = tokenId
    ? await mirrorGet<{ name: string; symbol: string; deleted: boolean }>(`/api/v1/tokens/${tokenId}`).catch(() => null)
    : null;
  if (tokenId && existing && !existing.deleted) {
    console.log(`COMPUTE_TOKEN_ID=${tokenId} already exists (${existing.name}, ${existing.symbol})`);
  } else {
    const response = await new TokenCreateTransaction()
      .setTokenName("DeComp Compute Credit")
      .setTokenSymbol("DCC")
      .setTokenMemo("Prepaid GPU compute on DeComp")
      .setDecimals(DECIMALS)
      .setInitialSupply(INITIAL_SUPPLY)
      .setTokenType(TokenType.FungibleCommon)
      .setSupplyType(TokenSupplyType.Infinite)
      .setTreasuryAccountId(operator.accountId)
      .setAdminKey(operator.privateKey.publicKey)
      .setSupplyKey(operator.privateKey.publicKey)
      .execute(client);
    tokenId = (await response.getReceipt(client)).tokenId!.toString();
    await upsertEnv({ COMPUTE_TOKEN_ID: tokenId });
    console.log(`created COMPUTE_TOKEN_ID=${tokenId} with ${formatDcc(INITIAL_SUPPLY)} ${hashscan}/token/${tokenId}`);
  }

  for (const role of ROLES) {
    const account = accountFromEnv(role);
    const associated = await associateTokens(client, account, [tokenId]);
    console.log(`  ${role.padEnd(10)} ${account.accountId.padEnd(12)} ${associated.length ? "associated" : "already associated"}`);
  }

  const agent = accountFromEnv("AGENT");
  // The mirror node lags consensus by a few seconds; a stale read only means a slightly larger top-up.
  const balance = (await getTokenBalance(agent.accountId, tokenId)) ?? 0n;
  if (balance < AGENT_TARGET_BALANCE) {
    const amount = AGENT_TARGET_BALANCE - balance;
    const token = TokenId.fromString(tokenId);
    const response = await new TransferTransaction()
      .addTokenTransfer(token, AccountId.fromString(operator.accountId), -amount)
      .addTokenTransfer(token, AccountId.fromString(agent.accountId), amount)
      .execute(client);
    await response.getReceipt(client);
    console.log(`  sent ${formatDcc(amount)} to AGENT (tx ${response.transactionId})`);
  } else {
    console.log(`  AGENT already holds ${formatDcc(balance)}`);
  }
} finally {
  client.close();
}
