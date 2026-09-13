/**
 * A loopback HTTP endpoint the spawned provider uses to sign as this node's account.
 *
 * The provider process can't hold the key — the account is keyed by the user's embedded wallet,
 * and only the live renderer can sign for it. So it asks here instead, and this forwards to the
 * renderer over the same IPC bridge provisioning and registration already use.
 *
 * Bound to 127.0.0.1 on an ephemeral port and gated by a token generated per start, so nothing
 * off this machine can reach it and nothing on it can use it without being handed the token.
 */
import { createServer, type Server } from "node:http";
import { randomBytes } from "node:crypto";
import type { BrowserWindow } from "electron";
import { signHederaBytes } from "./identity/embedded-wallet-identity";
import { createWindowSigner } from "./identity/renderer-signer";

export type SignerEndpoint = { url: string; token: string; close: () => void };

export async function startSignerEndpoint(win: BrowserWindow): Promise<SignerEndpoint> {
  const token = randomBytes(32).toString("hex");
  const sign = createWindowSigner(win, 60_000);

  const server: Server = createServer((req, res) => {
    const reply = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };

    if (req.method !== "POST" || req.url !== "/sign") return reply(404, { error: "not found" });
    if (req.headers.authorization !== `Bearer ${token}`) return reply(401, { error: "unauthorized" });

    const chunks: Buffer[] = [];
    req.on("data", chunk => chunks.push(chunk as Buffer));
    req.on("end", () => {
      void (async () => {
        try {
          const { message } = JSON.parse(Buffer.concat(chunks).toString()) as { message?: string };
          if (typeof message !== "string") return reply(400, { error: "message must be base64" });
          const signature = await signHederaBytes(sign, new Uint8Array(Buffer.from(message, "base64")));
          reply(200, { signature: Buffer.from(signature).toString("base64") });
        } catch (error) {
          reply(500, { error: error instanceof Error ? error.message : String(error) });
        }
      })();
    });
  });

  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("signer endpoint failed to bind");

  return { url: `http://127.0.0.1:${address.port}`, token, close: () => server.close() };
}
