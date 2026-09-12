/**
 * Verifies a Privy access token server-side, per Privy's documented scheme: an ES256 JWT with
 * `iss: "privy.io"`, `aud: <app id>`, and `sub` holding the user's Privy DID. No Privy SDK is used
 * here — this stays on plain `jose`, the same zero-extra-SDK approach as packages/privy-hedera's
 * signing client. The verification key is public (it only verifies, never signs); the app secret
 * that actually authorizes wallet signing is never involved in this path.
 */
import { importSPKI, jwtVerify, type KeyLike } from "jose";
import { env } from "./env";

let cachedKey: Promise<KeyLike> | undefined;

function verificationKey(): Promise<KeyLike> {
  return (cachedKey ??= importSPKI(env.privyVerificationKey, "ES256"));
}

/** The verified user's Privy DID, or null if the token doesn't check out. Never throws. */
export async function verifyPrivyAccessToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, await verificationKey(), { issuer: "privy.io", audience: env.privyAppId });
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}
