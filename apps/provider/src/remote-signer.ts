/**
 * An identity whose signing happens somewhere else, over a loopback HTTP call.
 *
 * This exists for the desktop node. Its Hedera account is keyed by the user's *embedded* wallet,
 * which can only be signed for by the live renderer session — there is no `<ROLE>_WALLET_ID` for
 * it, so privyIdentity() can't resolve it and this process can never hold the key itself. The
 * Electron app runs a signer endpoint bound to 127.0.0.1 and passes its URL and a one-shot token
 * in; every signature still happens inside Privy, one hop further away.
 *
 * Only `accountId` and `signMessage` are provided, which is all the bridge handshake needs. HCS
 * registration is published by the app itself (it has the full identity), so nothing here needs a
 * Hedera Client.
 */
export type RemoteSignerIdentity = { accountId: string; signMessage: (message: Uint8Array) => Promise<Uint8Array> };

export function remoteSignerIdentity(accountId: string, signerUrl: string, token: string): RemoteSignerIdentity {
  return {
    accountId,
    async signMessage(message) {
      const response = await fetch(`${signerUrl.replace(/\/$/, "")}/sign`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ message: Buffer.from(message).toString("base64") }),
        // The renderer may have to round-trip to Privy, so allow well past a normal loopback call.
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) {
        throw new Error(`signer endpoint returned ${response.status}: ${(await response.text()).slice(0, 200)}`);
      }
      const { signature } = (await response.json()) as { signature?: string };
      if (typeof signature !== "string") throw new Error("signer endpoint returned no signature");
      return new Uint8Array(Buffer.from(signature, "base64"));
    },
  };
}
