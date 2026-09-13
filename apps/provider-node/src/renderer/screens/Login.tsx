import { usePrivy } from "@privy-io/react-auth";
import { Button } from "../components/Button";

export function Login() {
  const { login } = usePrivy();
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", position: "relative", zIndex: 1 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 20, alignItems: "flex-start", maxWidth: 480 }}>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 10,
            border: "1px solid var(--line)",
            borderRadius: 999,
            padding: "7px 14px",
            fontSize: 11,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: "var(--muted)",
          }}
        >
          <span style={{ width: 5, height: 5, borderRadius: 999, background: "var(--accent)", animation: "decomp-breathe 2.6s ease-in-out infinite" }} />
          provider node
        </div>
        <h1 className="font-serif" style={{ fontSize: 56, lineHeight: 1, margin: 0 }}>
          run a GPU, <em style={{ color: "var(--accent)", fontStyle: "italic" }}>get paid</em>
        </h1>
        <p style={{ color: "var(--muted)", margin: 0, lineHeight: 1.7, maxWidth: "46ch" }}>
          Sign in with your own account — this app never sees a private key. Your wallet lives entirely on this machine.
        </p>
        <Button onClick={login}>sign in with email</Button>
      </div>
    </div>
  );
}
