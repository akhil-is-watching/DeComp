/** PKCE (RFC 7636), S256 only — required on every /authorize + /token pair. */

async function digestSha256(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

export async function challengeFromVerifier(verifier: string): Promise<string> {
  return Buffer.from(await digestSha256(verifier)).toString("base64url");
}

export async function verifyChallenge(verifier: string, challenge: string): Promise<boolean> {
  if (!verifier || !challenge) return false;
  return (await challengeFromVerifier(verifier)) === challenge;
}
