/**
 * Creates and funds the agent + provider accounts from one operator account, then associates
 * each with the configured HTS tokens. Idempotent: roles that already have credentials in .env
 * are checked and associated, never recreated. Keys are written to .env as each account is
 * created, so a failure partway through doesn't strand funded accounts.
 */
import { AccountBalanceQuery, AccountCreateTransaction, Hbar, PrivateKey } from "@hiero-ledger/sdk";
import {
  accountFromEnv,
  associateTokens,
  formatTinybars,
  hederaNetwork,
  parsePrivateKey,
  requireEnv,
  sdkClient,
  type AccountCredentials,
} from "@decomp/hedera-x402";
import { upsertEnv } from "./lib/env-file";

const network = hederaNetwork();
const hashscanNet = network === "hedera:mainnet" ? "mainnet" : "testnet";

const roles = [
  { prefix: "AGENT", initialHbar: Number(process.env.AGENT_INITIAL_HBAR ?? 50) },
  ...[1, 2, 3].map(n => ({ prefix: `PROVIDER_${n}`, initialHbar: Number(process.env.PROVIDER_INITIAL_HBAR ?? 5) })),
];
const tokenIds = (process.env.ASSOCIATE_TOKEN_IDS ?? "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

const operator: AccountCredentials = {
  accountId: requireEnv("OPERATOR_ID"),
  privateKey: parsePrivateKey(requireEnv("OPERATOR_KEY")),
};
const client = sdkClient(operator, network);

async function createAccount(prefix: string, initialHbar: number): Promise<AccountCredentials> {
  const privateKey = PrivateKey.generateECDSA();
  // No EVM alias: the x402 facilitator's alias policy wants plain 0.0.x payTo accounts.
  const response = await new AccountCreateTransaction()
    .setKeyWithoutAlias(privateKey.publicKey)
    .setInitialBalance(new Hbar(initialHbar))
    .execute(client);
  const receipt = await response.getReceipt(client);
  const accountId = receipt.accountId!.toString();
  await upsertEnv({ [`${prefix}_ACCOUNT_ID`]: accountId, [`${prefix}_PRIVATE_KEY`]: privateKey.toStringRaw() });
  console.log(`  created ${prefix} ${accountId} with ${initialHbar} ℏ (tx ${response.transactionId})`);
  return { accountId, privateKey };
}

console.log(`Operator ${operator.accountId} on ${network}`);
const summary: { role: string; accountId: string; balance: string }[] = [];

try {
  for (const { prefix, initialHbar } of roles) {
    const hasCredentials = Boolean(process.env[`${prefix}_ACCOUNT_ID`] && process.env[`${prefix}_PRIVATE_KEY`]);
    const account = hasCredentials ? accountFromEnv(prefix) : await createAccount(prefix, initialHbar);
    if (hasCredentials) console.log(`  using existing ${prefix} ${account.accountId}`);

    const associated = await associateTokens(client, account, tokenIds, { knownUnassociated: !hasCredentials });
    if (associated.length > 0) console.log(`  associated ${prefix} with ${associated.join(", ")}`);

    const balance = await new AccountBalanceQuery().setAccountId(account.accountId).execute(client);
    summary.push({ role: prefix, accountId: account.accountId, balance: formatTinybars(balance.hbars.toTinybars().toString()) });
  }
} finally {
  client.close();
}

console.log();
for (const { role, accountId, balance } of summary) {
  console.log(`${role.padEnd(11)} ${accountId.padEnd(12)} ${balance.padStart(14)}  https://hashscan.io/${hashscanNet}/account/${accountId}`);
}
