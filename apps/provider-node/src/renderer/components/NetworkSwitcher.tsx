/**
 * The network badge in the toolbar, as a menu. Switching applies at once and refetches everything
 * — balances, jobs and the registry are all read against whichever network is selected here.
 */
import { IconCheck } from "./icons";
import { Popover } from "./Popover";
import type { Settings } from "../../main/settings-store";

type Network = Settings["network"];

const NETWORKS: { id: Network; label: string; caption: string }[] = [
  { id: "hedera:testnet", label: "Testnet", caption: "free HBAR, for trying things out" },
  { id: "hedera:mainnet", label: "Mainnet", caption: "real HBAR, real earnings" },
];

export function NetworkSwitcher({ network, onChange }: { network: Network; onChange: (network: Network) => void }) {
  const testnet = network === "hedera:testnet";

  return (
    <Popover
      width={266}
      trigger={open => (
        <button
          className="chip no-drag"
          aria-label="Switch network"
          title="Switch network"
          style={{
            padding: "5px 11px",
            color: testnet ? "var(--muted)" : "var(--accent)",
            borderColor: testnet ? "var(--line)" : "color-mix(in srgb, var(--accent) 42%, transparent)",
            background: testnet ? "transparent" : "var(--accent-softer)",
          }}
        >
          <span
            aria-hidden
            style={{
              width: 5,
              height: 5,
              borderRadius: 999,
              background: testnet ? "var(--muted)" : "var(--accent)",
              animation: testnet ? undefined : "decomp-breathe 2.4s ease-in-out infinite",
            }}
          />
          <span style={{ fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase" }}>{testnet ? "testnet" : "mainnet"}</span>
          <span aria-hidden style={{ fontSize: 9, opacity: 0.7, transform: open ? "rotate(180deg)" : undefined, transition: "transform 140ms var(--ease)" }}>
            ▾
          </span>
        </button>
      )}
    >
      {close => (
        <>
          <div style={{ padding: "6px 10px 8px", fontSize: 11, letterSpacing: "0.09em", textTransform: "uppercase", color: "var(--muted)" }}>
            Network
          </div>
          {NETWORKS.map(option => (
            <button
              key={option.id}
              role="menuitemradio"
              aria-checked={network === option.id}
              className="row-button"
              onClick={() => {
                close();
                if (option.id !== network) onChange(option.id);
              }}
              style={{ display: "flex", alignItems: "flex-start", gap: 9, padding: "8px 10px", borderRadius: 8 }}
            >
              <span style={{ width: 14, flexShrink: 0, marginTop: 2, color: "var(--accent)" }}>
                {network === option.id && <IconCheck size={13} />}
              </span>
              <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                <span style={{ fontSize: 13, color: network === option.id ? "var(--text)" : "var(--muted-bright)" }}>{option.label}</span>
                <span style={{ fontSize: 11.5, color: "var(--muted)" }}>{option.caption}</span>
              </span>
            </button>
          ))}
          <div style={{ padding: "8px 10px 4px", marginTop: 4, borderTop: "1px solid var(--line)", fontSize: 11.5, color: "var(--muted)", lineHeight: 1.55 }}>
            Your account and the marketplace topics exist on one network — the other will read empty.
          </div>
        </>
      )}
    </Popover>
  );
}
