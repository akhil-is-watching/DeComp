import { PrivateKey } from "@hiero-ledger/sdk";

/**
 * Accepts ECDSA keys as hex (with or without 0x) or DER, the two formats portal.hedera.com shows.
 *
 * Account keys live in Privy, so this is only for one-time bootstrap input passed on the command
 * line (see `bun run setup:privy`), never for anything read from .env.
 */
export function parsePrivateKey(text: string): PrivateKey {
  const value = text.trim().replace(/^0x/i, "");
  if (value.startsWith("30") && value.length > 64) {
    return PrivateKey.fromStringDer(value);
  }
  return PrivateKey.fromStringECDSA(value);
}

export type AccountCredentials = { accountId: string; privateKey: PrivateKey };
