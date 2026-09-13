import { usePrivy } from "@privy-io/react-auth";
import { Button } from "../components/Button";
import { IconBolt, IconBroadcast, IconWallet } from "../components/icons";
import { DragStrip } from "../components/DragStrip";

/**
 * First run and every logged-out launch. The product name leads: it's the only screen where the
 * brand gets to be the subject, so it's the lockup, not a chip in the corner. The old pitch line
 * stays, one step down the hierarchy.
 */
export function Login() {
  const { login } = usePrivy();
  return (
    <div style={{ position: "relative", zIndex: 1, minHeight: "100vh", display: "grid", placeItems: "center", padding: 40 }}>
      <DragStrip />
      <div className="rise no-drag" style={{ display: "flex", flexDirection: "column", gap: 30, maxWidth: 580, width: "100%" }}>
        <Wordmark />

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <h1 className="font-serif" style={{ fontSize: 30, lineHeight: 1.15, margin: 0, letterSpacing: "-0.01em", fontWeight: 400 }}>
            run a GPU, <em style={{ color: "var(--accent)", fontStyle: "italic" }}>get paid</em>
          </h1>
          <p style={{ color: "var(--muted)", margin: 0, lineHeight: 1.8, maxWidth: "54ch", fontSize: 14 }}>
            Sell time on this Mac's GPU to AI agents, metered by the second and settled on Hedera. Sign in with your email — this app never
            sees a private key, and your wallet stays on this machine.
          </p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Point icon={<IconWallet size={15} />}>A Hedera account is created for you on first sign-in — nothing to fund, nothing to paste.</Point>
          <Point icon={<IconBolt size={15} />}>Agents pay per five-second tick; an unpaid job is killed rather than run for free.</Point>
          <Point icon={<IconBroadcast size={15} />}>Every job leaves an audit record on-chain, so the earnings here can be re-checked.</Point>
        </div>

        <div style={{ marginTop: 2 }}>
          <Button onClick={login}>sign in with email</Button>
        </div>
      </div>
    </div>
  );
}

function Wordmark() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 14 }}>
        <span className="font-serif" style={{ fontSize: 68, lineHeight: 0.9, letterSpacing: "-0.025em" }}>
          decomp
        </span>
        <span
          aria-hidden
          style={{
            width: 10,
            height: 10,
            borderRadius: 999,
            background: "var(--accent)",
            marginBottom: 10,
            animation: "decomp-breathe 3.4s ease-in-out infinite",
          }}
        />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <span style={{ fontSize: 13, letterSpacing: "0.42em", textTransform: "uppercase", color: "var(--muted-bright)" }}>node</span>
        <span style={{ flex: 1, height: 1, background: "var(--line)", maxWidth: 300 }} />
      </div>
    </div>
  );
}

function Point({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 12, color: "var(--muted)", fontSize: 13, lineHeight: 1.7 }}>
      <span style={{ color: "var(--accent)", marginTop: 2, flexShrink: 0 }}>{icon}</span>
      <span style={{ maxWidth: "54ch" }}>{children}</span>
    </div>
  );
}
