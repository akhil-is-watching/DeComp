import { AccountId, Client, PrivateKey } from "@hiero-ledger/sdk";
import { hederaNetwork, requireEnv, type HederaNetwork } from "./config";

/** Accepts ECDSA keys as hex (with or without 0x) or DER, the two formats portal.hedera.com shows. */
export function parsePrivateKey(text: string): PrivateKey {
  const value = text.trim().replace(/^0x/i, "");
  if (value.startsWith("30") && value.length > 64) {
    return PrivateKey.fromStringDer(value);
  }
  return PrivateKey.fromStringECDSA(value);
}

export type AccountCredentials = { accountId: string; privateKey: PrivateKey };

/** Reads `<PREFIX>_ACCOUNT_ID` and `<PREFIX>_PRIVATE_KEY`, e.g. `AGENT` or `PROVIDER_1`. */
export function accountFromEnv(prefix: string): AccountCredentials {
  return {
    accountId: requireEnv(`${prefix}_ACCOUNT_ID`),
    privateKey: parsePrivateKey(requireEnv(`${prefix}_PRIVATE_KEY`)),
  };
}

export function sdkClient(operator: AccountCredentials, network: HederaNetwork = hederaNetwork()): Client {
  const client = network === "hedera:mainnet" ? Client.forMainnet() : Client.forTestnet();
  return client.setOperator(AccountId.fromString(operator.accountId), operator.privateKey);
}
