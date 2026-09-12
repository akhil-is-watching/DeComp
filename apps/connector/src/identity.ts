/**
 * Resolves the HederaIdentity a connector user pays with. First login for a Privy DID provisions a
 * fresh Privy wallet and a funded, token-associated Hedera account (paid for by the existing
 * OPERATOR identity); every later call for the same DID reuses the cached wallet/account from
 * db.ts. This is the OAuth-connector seam identity.ts's own header comment describes — everything
 * downstream (apps/agent's runJob, discoverAndRunJob, ...) takes the same HederaIdentity it always did.
 */
import {
  hederaPublicKeyFor,
  identityForUser,
  privyClientFromEnv,
  privyIdentity,
  provisionUserIdentity,
  walletForUser,
  type HederaIdentity,
  type PrivyHederaWallet,
  type WalletResolver,
} from "@decomp/privy-hedera";
import { hederaNetwork } from "@decomp/hedera-x402";
import { getUser, putUser } from "./db";
import { env } from "./env";

const privy = privyClientFromEnv();
const network = hederaNetwork();

// One in-flight resolution per DID, so concurrent tool calls in a fresh session don't race to
// provision two wallets for the same first-time login.
const inFlight = new Map<string, Promise<PrivyHederaWallet>>();

async function resolveWallet(did: string): Promise<PrivyHederaWallet> {
  const cached = getUser(did);
  if (cached) {
    const wallet = await privy.getWallet(cached.wallet_id);
    return { walletId: cached.wallet_id, accountId: cached.account_id, publicKey: await hederaPublicKeyFor(privy, wallet) };
  }

  const created = await walletForUser(privy, did);
  const operator = await privyIdentity("OPERATOR");
  const payer = operator.createClient();
  try {
    const provisioned = await provisionUserIdentity(privy, created, payer, {
      initialHbar: env.userInitialHbar,
      associateTokenIds: [...(env.computeTokenId ? [env.computeTokenId] : []), ...env.associateTokenIds],
      network,
    });
    putUser(did, provisioned.walletId, provisioned.accountId);
    return provisioned;
  } finally {
    payer.close();
  }
}

// This is exactly the shape of packages/privy-hedera's WalletResolver — "role" there is any
// string a wallet is keyed by, and a Privy DID fits that as well as "AGENT" or "PROVIDER_1" do.
export const getOrCreateUserWallet: WalletResolver = (did: string): Promise<PrivyHederaWallet> => {
  const running = inFlight.get(did) ?? resolveWallet(did).finally(() => inFlight.delete(did));
  inFlight.set(did, running);
  return running;
};

export async function identityFor(did: string): Promise<HederaIdentity> {
  const wallet = await getOrCreateUserWallet(did);
  return identityForUser(did, wallet, { privy, network });
}
