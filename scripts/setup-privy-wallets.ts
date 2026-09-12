/**
 * Creates the Privy wallets that sign for DeComp and the Hedera accounts they key, then records
 * their ids in .env. No Hedera private key is ever stored: wallets stay in Privy and sign there.
 *
 *   # first run: fund the operator account from an existing funded account (the key is used once,
 *   # passed on the command line, and never written to .env)
 *   bun run setup:privy -- --bootstrap-account 0.0.1234 --bootstrap-key <hex or DER key>
 *
 *   # afterwards, the operator's Privy wallet pays for everything
 *   bun run setup:privy
 *
 * Safe to re-run: existing wallets and accounts in .env are checked, not recreated.
 */
import { parseArgs } from "node:util";
import { AccountBalanceQuery, AccountCreateTransaction, AccountId, Client, Hbar, PrivateKey } from "@hiero-ledger/sdk";
import {
  hederaPublicKeyFor,
  privyClientFromEnv,
  privySdkClient,
  type PrivyHederaWallet,
} from "@decomp/privy-hedera";
import { associateTokens, formatTinybars, hederaNetwork, mirrorGet, networkConfig, parsePrivateKey } from "@decomp/hedera-x402";
import { upsertEnv } from "./lib/env-file";

const { values } = parseArgs({
  options: { "bootstrap-account": { type: "string" }, "bootstrap-key": { type: "string" } },
});

const network = hederaNetwork();
const { hashscan } = networkConfig();
const privy = privyClientFromEnv();

const ROLES = [
  { role: "OPERATOR", initialHbar: Number(process.env.OPERATOR_INITIAL_HBAR ?? 200) },
  { role: "AGENT", initialHbar: Number(process.env.AGENT_INITIAL_HBAR ?? 50) },
  ...[1, 2, 3].map(n => ({ role: `PROVIDER_${n}`, initialHbar: Number(process.env.PROVIDER_INITIAL_HBAR ?? 5) })),
];
const tokenIds = (process.env.ASSOCIATE_TOKEN_IDS ?? "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

/** The Privy wallet for a role, created on first run. */
async function walletFor(role: string): Promise<Omit<PrivyHederaWallet, "accountId">> {
  let walletId = process.env[`${role}_WALLET_ID`]?.trim();
  if (!walletId) {
    const created = await privy.createWallet({
      displayName: `DeComp ${role}`,
      externalId: `decomp-${role.toLowerCase()}`,
      idempotencyKey: `decomp-${role.toLowerCase()}`,
    });
    walletId = created.id;
    await upsertEnv({ [`${role}_WALLET_ID`]: walletId });
    console.log(`  created Privy wallet ${walletId} (${created.address}) for ${role}`);
  }
  const wallet = await privy.getWallet(walletId);
  return { walletId, publicKey: await hederaPublicKeyFor(privy, wallet) };
}

/** Checks an account already in .env is really keyed to this wallet. */
async function assertAccountMatchesWallet(accountId: string, wallet: Omit<PrivyHederaWallet, "accountId">) {
  const account = await mirrorGet<{ key: { _type: string; key: string } | null }>(`/api/v1/accounts/${accountId}`);
  const onChain = account.key?.key?.toLowerCase();
  if (!onChain || !wallet.publicKey.toStringRaw().toLowerCase().endsWith(onChain)) {
    throw new Error(`${accountId} is not keyed to Privy wallet ${wallet.walletId}; clear its *_ACCOUNT_ID to create a new account`);
  }
}

async function createAccount(payer: Client, role: string, wallet: Omit<PrivyHederaWallet, "accountId">, initialHbar: number) {
  const response = await new AccountCreateTransaction()
    .setKeyWithoutAlias(wallet.publicKey)
    .setInitialBalance(new Hbar(initialHbar))
    .execute(payer);
  const accountId = (await response.getReceipt(payer)).accountId!.toString();
  await upsertEnv({ [`${role}_ACCOUNT_ID`]: accountId });
  console.log(`  created ${role} account ${accountId} with ${initialHbar} ℏ (tx ${response.transactionId})`);
  return accountId;
}

/** Pays for the operator's own account: a one-time transfer from an existing funded account. */
function bootstrapClient(): Client {
  const accountId = values["bootstrap-account"];
  const key = values["bootstrap-key"];
  if (!accountId || !key) {
    throw new Error(
      "OPERATOR_ACCOUNT_ID is not set yet, so the first run needs a funded account to create it:\n" +
        "  bun run setup:privy -- --bootstrap-account 0.0.1234 --bootstrap-key <key>",
    );
  }
  const client = network === "hedera:mainnet" ? Client.forMainnet() : Client.forTestnet();
  return client.setOperator(AccountId.fromString(accountId), parsePrivateKey(key) as PrivateKey);
}

console.log(`Privy wallets on ${network}`);
const summary: { role: string; walletId: string; accountId: string; balance: string }[] = [];
let operatorClient: Client | undefined;
let bootstrap: Client | undefined;

try {
  for (const { role, initialHbar } of ROLES) {
    const wallet = await walletFor(role);
    let accountId = process.env[`${role}_ACCOUNT_ID`]?.trim();
    if (accountId) {
      await assertAccountMatchesWallet(accountId, wallet);
      console.log(`  using existing ${role} account ${accountId}`);
    } else {
      const payer = role === "OPERATOR" ? (bootstrap ??= bootstrapClient()) : operatorClient!;
      accountId = await createAccount(payer, role, wallet, initialHbar);
    }

    const signed: PrivyHederaWallet = { ...wallet, accountId };
    const client = privySdkClient(privy, signed, network);
    if (role === "OPERATOR") operatorClient = client;

    if (tokenIds.length > 0) {
      // The account is this client's operator, so executing the association signs it through Privy.
      const associated = await associateTokens(client, { accountId }, tokenIds).catch(error => {
        console.error(`  could not associate ${role} with ${tokenIds.join(", ")}: ${error}`);
        return [];
      });
      if (associated.length > 0) console.log(`  associated ${role} with ${associated.join(", ")}`);
    }

    const balance = await new AccountBalanceQuery().setAccountId(accountId).execute(client);
    summary.push({ role, walletId: wallet.walletId, accountId, balance: formatTinybars(balance.hbars.toTinybars().toString()) });
    if (role !== "OPERATOR") client.close();
  }
} finally {
  operatorClient?.close();
  bootstrap?.close();
}

console.log();
for (const { role, walletId, accountId, balance } of summary) {
  console.log(`${role.padEnd(11)} ${walletId.padEnd(26)} ${accountId.padEnd(12)} ${balance.padStart(14)}  ${hashscan}/account/${accountId}`);
}
