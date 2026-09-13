/**
 * The app's only chrome. The window is `titleBarStyle: "hiddenInset"`, so this bar sits beside
 * the traffic lights and does the job the left sidebar used to: navigation, plus the two pieces
 * of state that are true on every screen — which network, and how fresh the numbers are.
 */
import { usePrivy } from "@privy-io/react-auth";
import { IconButton } from "./IconButton";
import { MenuItem, Popover } from "./Popover";
import { Segmented, type Segment } from "./Segmented";
import { NetworkSwitcher } from "./NetworkSwitcher";
import { IconLogout, IconRefresh, IconUser } from "./icons";
import { relativeTime } from "../lib/format";
import { useNow } from "../hooks/useNow";
import type { Settings } from "../../main/settings-store";

export function TitleBar<T extends string>({
  segments,
  tab,
  onTab,
  network,
  onNetworkChange,
  refreshedAt,
  refreshing,
  onRefresh,
  accountLabel,
}: {
  segments: readonly Segment<T>[];
  tab: T;
  onTab: (id: T) => void;
  network: Settings["network"];
  onNetworkChange: (network: Settings["network"]) => void;
  refreshedAt: Date | null;
  refreshing: boolean;
  onRefresh: () => void;
  accountLabel: string;
}) {
  const { logout } = usePrivy();
  const now = useNow(10_000);

  return (
    <header className="titlebar drag">
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexShrink: 0 }}>
        <span className="font-serif" style={{ fontSize: 19, letterSpacing: "-0.01em" }}>
          decomp
        </span>
        <span
          aria-hidden
          style={{ width: 5, height: 5, borderRadius: 999, background: "var(--accent)", animation: "decomp-breathe 3.4s ease-in-out infinite" }}
        />
      </div>

      <div style={{ flex: 1, display: "flex", justifyContent: "center", minWidth: 0 }}>
        <Segmented segments={segments} value={tab} onChange={onTab} ariaLabel="Sections" />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
        <span className="no-drag" title={refreshedAt ? refreshedAt.toLocaleTimeString() : "not read yet"} style={{ fontSize: 12, color: "var(--muted)" }}>
          {refreshing ? "syncing…" : refreshedAt ? relativeTime(refreshedAt, now) : "—"}
        </span>
        <IconButton label="Refresh from the mirror node" onClick={onRefresh} disabled={refreshing}>
          <IconRefresh size={14} style={{ animation: refreshing ? "decomp-spin 900ms linear infinite" : undefined }} />
        </IconButton>
        <NetworkSwitcher network={network} onChange={onNetworkChange} />
        <Popover
          width={252}
          trigger={() => (
            <IconButton label="Account">
              <IconUser size={15} />
            </IconButton>
          )}
        >
          {close => (
            <>
              <div style={{ padding: "8px 10px 10px", borderBottom: "1px solid var(--line)", marginBottom: 4 }}>
                <div style={{ fontSize: 11.5, letterSpacing: "0.09em", textTransform: "uppercase", color: "var(--muted)" }}>signed in as</div>
                <div className="selectable" style={{ fontSize: 13, marginTop: 5, wordBreak: "break-all", color: "var(--text)" }}>
                  {accountLabel}
                </div>
              </div>
              <MenuItem
                tone="crit"
                onClick={() => {
                  close();
                  void logout();
                }}
              >
                <IconLogout size={14} />
                Log out
              </MenuItem>
            </>
          )}
        </Popover>
      </div>
    </header>
  );
}
