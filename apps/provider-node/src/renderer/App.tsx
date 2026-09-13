import { useState } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { DashboardBackdrop, WelcomeBackdrop } from "./components/Backdrop";
import { TitleBar } from "./components/TitleBar";
import { IconCoins, IconGauge, IconLayers, IconSliders } from "./components/icons";
import type { Segment } from "./components/Segmented";
import { SigningBridge } from "./signing-bridge";
import { useAccountProvisioning } from "./hooks/useAccountProvisioning";
import { useAppData } from "./state/AppData";
import { Login } from "./screens/Login";
import { SetupFailed, Splash } from "./screens/Splash";
import { Onboarding } from "./screens/Onboarding";
import { Overview } from "./screens/Overview";
import { Jobs } from "./screens/Jobs";
import { Earnings } from "./screens/Earnings";
import { SettingsScreen } from "./screens/Settings";

export type TabId = "overview" | "jobs" | "earnings" | "settings";

const TABS: readonly Segment<TabId>[] = [
  { id: "overview", label: "Overview", icon: <IconGauge size={13} /> },
  { id: "jobs", label: "Jobs", icon: <IconLayers size={13} /> },
  { id: "earnings", label: "Earnings", icon: <IconCoins size={13} /> },
  { id: "settings", label: "Settings", icon: <IconSliders size={13} /> },
];

export function App() {
  const { ready, authenticated, user } = usePrivy();
  const { wallets } = useWallets();
  const { settings, save, refresh, refreshedAt, refreshing } = useAppData();
  const embeddedWallet = wallets.find(w => w.walletClientType === "privy");
  const provisioning = useAccountProvisioning(settings, save, embeddedWallet);
  const [tab, setTab] = useState<TabId>("overview");

  const signedIn =
    ready &&
    authenticated &&
    settings !== null &&
    !!settings.onboardedAt &&
    provisioning.status !== "provisioning" &&
    provisioning.status !== "error" &&
    !!embeddedWallet;

  return (
    <div style={{ position: "relative", height: "100vh", display: "flex", flexDirection: "column" }}>
      {signedIn ? <DashboardBackdrop /> : <WelcomeBackdrop />}
      {authenticated && <SigningBridge />}
      {renderStage()}
    </div>
  );

  function renderStage() {
    if (!ready || !settings) return <Splash />;
    if (!authenticated) return <Login />;

    // The signing bridge above is mounted before this gate on purpose: provisioning asks the
    // renderer to sign, so it has to be live before the request can be answered, not only once
    // the dashboard renders.
    if (!embeddedWallet || provisioning.status === "provisioning") {
      return <Splash caption="Setting up your Hedera account. This happens once — your wallet's own key becomes the account key." />;
    }
    if (provisioning.status === "error") {
      return <SetupFailed error={provisioning.error} onRetry={() => window.location.reload()} />;
    }
    // The account exists by here, so onboarding can show it while asking for the one thing only
    // the user can supply.
    if (!settings.onboardedAt) return <Onboarding />;

    return (
      <>
        <TitleBar
          segments={TABS}
          tab={tab}
          onTab={setTab}
          network={settings.network}
          onNetworkChange={network => void save({ network })}
          refreshedAt={refreshedAt}
          refreshing={refreshing}
          onRefresh={refresh}
          accountLabel={user?.email?.address ?? user?.id ?? "—"}
        />
        <main className="scroll-area" style={{ flex: 1, position: "relative", zIndex: 1 }}>
          <div key={tab} className="rise" style={{ padding: "26px 28px 40px", maxWidth: 1180, margin: "0 auto" }}>
            {tab === "overview" && <Overview onOpenTab={setTab} />}
            {tab === "jobs" && <Jobs onOpenTab={setTab} />}
            {tab === "earnings" && <Earnings onOpenTab={setTab} />}
            {tab === "settings" && <SettingsScreen />}
          </div>
        </main>
      </>
    );
  }
}
