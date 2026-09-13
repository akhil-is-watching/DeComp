/**
 * Creates and funds a Hedera account for a brand-new embedded wallet, so logging in is enough —
 * nobody has to go find a funded testnet account and type an id into Settings.
 *
 * This is the one place Provider Node still depends on something other than the user's own
 * wallet: creating a Hedera account needs an existing funded payer, and an embedded wallet that's
 * never had one yet obviously isn't one. The payer here is this project's own OPERATOR identity
 * (read from the monorepo's root .env, same as scripts/setup-privy-wallets.ts and apps/connector
 * already do) — it pays a small one-time creation fee and gets no ongoing control: the account's
 * key is the embedded wallet's own recovered public key, not the operator's. Every signature after
 * this point — bridge handshake, HCS registration — is the embedded wallet's alone. A production
 * deployment of Provider Node aimed at strangers would need a different funding source (a faucet,
 * or the user bringing their own funded account) — noted here rather than pretended away.
 *
 * Deliberately does NOT reuse packages/privy-hedera's provisionUserIdentity wholesale: its token
 * association step signs through Privy's REST API by wallet id, which only exists for real Privy
 * server wallets. An embedded wallet has no such id — the only way to sign as it is the renderer's
 * live session (a RawSigner), so association here goes through the embedded wallet's own Hedera
 * client instead. Account *creation* has no such problem (createFundedAccount only reads the new
 * wallet's public key; the payer signs, not the new account), so that part is reused as is.
 *
 * No Electron import here — driven by a plain RawSigner, same reasoning as
 * embedded-wallet-identity.ts, so this is unit-testable without a real window.
 */
import { createFundedAccount, privyClientFromEnv, privyIdentity } from "@decomp/privy-hedera";
import { associateTokens, hederaNetwork, type HederaNetwork } from "@decomp/hedera-x402";
import { createEmbeddedWalletIdentity, recoverPublicKeyFromEmbeddedWallet, type RawSigner } from "./identity/embedded-wallet-identity";

export type ProvisionResult = { accountId: string };

export async function provisionAccountForSigner(
  sign: RawSigner,
  address: string,
  associateTokenIds: string[],
  network: HederaNetwork = hederaNetwork(),
): Promise<ProvisionResult> {
  const publicKey = await recoverPublicKeyFromEmbeddedWallet(sign, address);

  const privy = privyClientFromEnv();
  const operator = await privyIdentity("OPERATOR", { privy, network });
  const payer = operator.createClient();
  let accountId: string;
  try {
    accountId = await createFundedAccount(payer, { walletId: address, publicKey }, 5);
  } finally {
    payer.close();
  }

  if (associateTokenIds.length > 0) {
    // The account the mirror node just heard about a moment ago may not be indexed yet.
    const identity = await retry(() => createEmbeddedWalletIdentity(sign, accountId, address, network), 6, 1_500);
    const client = identity.createClient();
    try {
      await associateTokens(client, { accountId }, associateTokenIds, { knownUnassociated: true });
    } finally {
      client.close();
    }
  }

  return { accountId };
}

async function retry<T>(fn: () => Promise<T>, attempts: number, delayMs: number): Promise<T> {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === attempts - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  throw new Error("unreachable");
}
