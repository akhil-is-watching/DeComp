import { useState } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { GlowBackground } from "./components/GlowBackground";
import { DotGridBackground } from "./components/DotGridBackground";
import { SigningBridge } from "./signing-bridge";
import { useSettings } from "./hooks/useSettings";
import { useAccountProvisioning } from "./hooks/useAccountProvisioning";
import { Login } from "./screens/Login";
import { Balance } from "./screens/Balance";
import { JobHistory } from "./screens/JobHistory";
import { RewardHistory } from "./screens/RewardHistory";
import { SettingsScreen } from "./screens/Settings";

const TABS = [
  { id: "balance", label: "balance", Component: Balance },
  { id: "jobs", label: "job history", Component: JobHistory },
  { id: "rewards", label: "reward history", Component: RewardHistory },
  { id: "settings", label: "settings", Component: SettingsScreen },
] as const;

export function App() {
  const { ready, authenticated, logout, user } = usePrivy();
  const { wallets } = useWallets();
  const { settings, save } = useSettings();
  const embeddedWallet = wallets.find(w => w.walletClientType === "privy");
  const provisioning = useAccountProvisioning(settings, save, embeddedWallet);
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("balance");

  if (!ready || !settings) return <Centered>loading…</Centered>;
  if (!authenticated) return <Login />;
  if (!embeddedWallet || provisioning.status === "provisioning") {
    return <Centered>setting up your Hedera account — this only happens once…</Centered>;
  }
  if (provisioning.status === "error") {
    return <Centered>could not set up your account: {provisioning.error}</Centered>;
  }

  const Active = TABS.find(t => t.id === tab)!.Component;

  return (
    <div style={{ position: "relative", minHeight: "100vh" }}>
      <GlowBackground />
      <DotGridBackground />
      <SigningBridge />
      <div style={{ position: "relative", zIndex: 1, display: "flex", minHeight: "100vh" }}>
        <nav
          style={{
            width: 200,
            flexShrink: 0,
            borderRight: "1px solid var(--line)",
            padding: "28px 20px",
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 28 }}>
            <span className="font-serif" style={{ fontSize: 20 }}>
              decomp
            </span>
            <span style={{ width: 6, height: 6, borderRadius: 999, background: "var(--accent)", animation: "decomp-breathe 3.4s ease-in-out infinite" }} />
          </div>
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                textAlign: "left",
                border: "none",
                background: tab === t.id ? "color-mix(in srgb, var(--accent) 12%, transparent)" : "transparent",
                color: tab === t.id ? "var(--accent)" : "var(--muted-bright)",
                borderRadius: 10,
                padding: "9px 12px",
                fontFamily: "inherit",
                fontSize: 12,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                cursor: "pointer",
              }}
            >
              {t.label}
            </button>
          ))}
          <div style={{ flex: 1 }} />
          <div style={{ color: "var(--muted)", fontSize: 11, marginBottom: 8, wordBreak: "break-all" }}>{user?.email?.address ?? user?.id}</div>
          <button
            onClick={logout}
            style={{ textAlign: "left", border: "none", background: "transparent", color: "var(--muted)", fontFamily: "inherit", fontSize: 11, cursor: "pointer", padding: 0 }}
          >
            log out
          </button>
        </nav>
        <main style={{ flex: 1, padding: 32, overflowY: "auto" }}>
          <Active />
        </main>
      </div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>{children}</div>;
}
