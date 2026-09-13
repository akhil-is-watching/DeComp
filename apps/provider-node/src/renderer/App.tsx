/**
 * Spike: prove a Privy embedded wallet can log in and produce a real, verifiable secp256k1
 * signature inside an Electron BrowserWindow, with no app secret anywhere in this process. If this
 * doesn't pass, the whole embedded-wallet architecture (see the plan doc) falls back to a
 * thin-backend approach instead — nothing past this screen gets built until it does.
 *
 * This file grows into the real dashboard shell once the spike passes; it isn't thrown away.
 */
import { useState } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { keccak_256 } from "@noble/hashes/sha3";
import { secp256k1 } from "@noble/curves/secp256k1";
import { evmAddressOf } from "@decomp/privy-hedera";
import { PublicKey } from "@hiero-ledger/sdk";

type SpikeResult = { ok: boolean; detail: string };

/** Mirrors packages/privy-hedera/src/client.ts's normalizeSignature: trim to 64 bytes, low-s. */
function normalizeSignature(hex: string): Uint8Array {
  const bytes = Buffer.from(hex.replace(/^0x/, ""), "hex");
  const compact = Uint8Array.from(bytes.subarray(0, 64));
  return secp256k1.Signature.fromCompact(compact).normalizeS().toCompactRawBytes();
}

/** Mirrors packages/privy-hedera/src/keys.ts's recoverPublicKey loop, driven by the embedded wallet instead of Privy's REST API. */
function recoverAndVerify(digest: Uint8Array, signature: Uint8Array, expectedAddress: string): { matched: boolean; recoveredAddress: string } {
  const sig = secp256k1.Signature.fromCompact(signature);
  for (const recoveryBit of [0, 1] as const) {
    const candidate = PublicKey.fromBytesECDSA(sig.addRecoveryBit(recoveryBit).recoverPublicKey(digest).toRawBytes(true));
    const address = evmAddressOf(candidate);
    if (address.toLowerCase() === expectedAddress.toLowerCase()) return { matched: true, recoveredAddress: address };
  }
  return { matched: false, recoveredAddress: "(no recovery bit matched)" };
}

export function App() {
  const { ready, authenticated, login, logout, user } = usePrivy();
  const { wallets } = useWallets();
  const [result, setResult] = useState<SpikeResult | null>(null);
  const [busy, setBusy] = useState(false);

  const embeddedWallet = wallets.find(w => w.walletClientType === "privy");

  async function runSpike() {
    if (!embeddedWallet) {
      setResult({ ok: false, detail: "No embedded wallet found on this account yet." });
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      const message = new TextEncoder().encode(`provider-node spike ${new Date().toISOString()}`);
      const digest = keccak_256(message);
      const digestHex = `0x${Buffer.from(digest).toString("hex")}`;

      const provider = await embeddedWallet.getEthereumProvider();
      const rawSignature = (await provider.request({ method: "secp256k1_sign", params: [digestHex] })) as string;
      const signature = normalizeSignature(rawSignature);
      const { matched, recoveredAddress } = recoverAndVerify(digest, signature, embeddedWallet.address);

      setResult({
        ok: matched,
        detail: matched
          ? `PASS — signature ${Buffer.from(signature).toString("hex").slice(0, 16)}… recovers to ${recoveredAddress}, matching the wallet's own address.`
          : `FAIL — recovered ${recoveredAddress}, wallet reports ${embeddedWallet.address}.`,
      });
    } catch (error) {
      setResult({ ok: false, detail: `FAIL — ${error instanceof Error ? error.message : String(error)}` });
    } finally {
      setBusy(false);
    }
  }

  if (!ready) return <Centered>loading…</Centered>;

  return (
    <Centered>
      <div style={{ display: "flex", flexDirection: "column", gap: 20, alignItems: "flex-start", maxWidth: 560 }}>
        <h1 className="font-serif" style={{ fontSize: 40, margin: 0 }}>
          provider node <span style={{ color: "var(--accent)" }}>spike</span>
        </h1>
        <p style={{ color: "var(--muted)", margin: 0, lineHeight: 1.6 }}>
          Logs in with a real Privy embedded wallet and produces one real, verifiable secp256k1 signature — no app secret
          anywhere in this process.
        </p>

        {!authenticated ? (
          <button onClick={login} style={buttonStyle}>
            log in with email
          </button>
        ) : (
          <>
            <div style={{ color: "var(--muted-bright)", fontSize: 12 }}>
              logged in as {user?.email?.address ?? user?.id} — embedded wallet: {embeddedWallet?.address ?? "(none yet)"}
            </div>
            <div style={{ display: "flex", gap: 12 }}>
              <button onClick={runSpike} disabled={busy} style={buttonStyle}>
                {busy ? "signing…" : "sign test message"}
              </button>
              <button onClick={logout} style={{ ...buttonStyle, background: "transparent", border: "1px solid var(--line)", color: "var(--text)" }}>
                log out
              </button>
            </div>
          </>
        )}

        {result && (
          <div
            style={{
              padding: "14px 18px",
              borderRadius: 12,
              border: `1px solid ${result.ok ? "var(--accent)" : "#ff6b6b"}`,
              color: result.ok ? "var(--text)" : "#ff6b6b",
              fontSize: 13,
              lineHeight: 1.6,
              wordBreak: "break-all",
            }}
          >
            {result.detail}
          </div>
        )}
      </div>
    </Centered>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 32 }}>{children}</div>;
}

const buttonStyle: React.CSSProperties = {
  borderRadius: 999,
  border: "none",
  background: "var(--accent)",
  color: "var(--ink)",
  padding: "12px 22px",
  fontFamily: "inherit",
  fontSize: 13,
  fontWeight: 500,
  letterSpacing: "0.04em",
  cursor: "pointer",
};
