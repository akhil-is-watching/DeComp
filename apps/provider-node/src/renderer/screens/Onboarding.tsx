/**
 * Shown once, after the Hedera account exists and before the dashboard opens. It asks for exactly
 * one thing — the name agents will see this node under — because that's the only piece of setup
 * that is genuinely the user's to decide. Everything else is either derived from their wallet or
 * fixed by the network they're joining.
 */
import { useState } from "react";
import { Button } from "../components/Button";
import { Copyable } from "../components/Copyable";
import { DragStrip } from "../components/DragStrip";
import { ExternalLink } from "../components/ExternalLink";
import { IconBolt, IconBroadcast, IconWallet } from "../components/icons";
import { useAppData } from "../state/AppData";

/** The registry accepts a providerId of 1–64 characters; keep the field honest about that. */
const MAX_NAME = 64;

export function Onboarding() {
  const { settings, save } = useAppData();
  const [name, setName] = useState(settings?.providerName ?? "");
  const [saving, setSaving] = useState(false);

  if (!settings) return null;

  const trimmed = name.trim();
  const tooLong = trimmed.length > MAX_NAME;
  const valid = trimmed.length > 0 && !tooLong;
  const explorer = `https://hashscan.io/${settings.network.split(":")[1]}`;

  async function finish() {
    if (!valid || saving) return;
    setSaving(true);
    try {
      await save({ providerName: trimmed, onboardedAt: new Date().toISOString() });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ position: "relative", zIndex: 1, minHeight: "100vh", display: "grid", placeItems: "center", padding: 40 }}>
      <DragStrip />
      <div className="rise no-drag" style={{ display: "flex", flexDirection: "column", gap: 28, maxWidth: 540, width: "100%" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <span style={{ fontSize: 11.5, letterSpacing: "0.28em", textTransform: "uppercase", color: "var(--muted)" }}>one last thing</span>
          <h1 className="font-serif" style={{ fontSize: 40, lineHeight: 1.1, margin: 0, letterSpacing: "-0.02em" }}>
            Name your node
          </h1>
          <p style={{ margin: 0, color: "var(--muted)", fontSize: 14, lineHeight: 1.8 }}>
            This is how agents browsing the marketplace will see you. You can change it later in Settings.
          </p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
          <label style={{ fontSize: 11.5, letterSpacing: "0.09em", textTransform: "uppercase", color: "var(--muted)" }} htmlFor="provider-name">
            Node name
          </label>
          <input
            id="provider-name"
            className="field selectable"
            autoFocus
            value={name}
            maxLength={MAX_NAME + 20}
            onChange={event => setName(event.target.value)}
            onKeyDown={event => event.key === "Enter" && void finish()}
            placeholder="hashir's mac studio"
            style={{ fontSize: 15, padding: "12px 14px" }}
          />
          <span style={{ fontSize: 12, color: tooLong ? "var(--viz-crit)" : "var(--muted)", minHeight: 17 }}>
            {tooLong ? `${trimmed.length} characters — the registry allows at most ${MAX_NAME}.` : "Anything recognisable. It's public."}
          </span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "16px 18px", borderRadius: "var(--r-md)", border: "1px solid var(--line)", background: "var(--surface-2)" }}>
          <span style={{ fontSize: 11.5, letterSpacing: "0.09em", textTransform: "uppercase", color: "var(--muted)" }}>Your account is ready</span>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            {settings.accountId ? (
              <>
                <Copyable value={settings.accountId} />
                <ExternalLink href={`${explorer}/account/${settings.accountId}`}>Hashscan</ExternalLink>
              </>
            ) : (
              <span style={{ color: "var(--muted)", fontSize: 13 }}>not provisioned yet</span>
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 9, marginTop: 2 }}>
            <Note icon={<IconWallet size={14} />}>Keyed by your own wallet — this app never holds the key.</Note>
            <Note icon={<IconBolt size={14} />}>Earnings land here as agents pay per five-second tick.</Note>
            <Note icon={<IconBroadcast size={14} />}>Every job is recorded on-chain, so the numbers can be re-checked.</Note>
          </div>
        </div>

        <div>
          <Button onClick={() => void finish()} disabled={!valid || saving}>
            {saving ? "saving…" : "open my dashboard"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Note({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 10, color: "var(--muted)", fontSize: 12.5, lineHeight: 1.6 }}>
      <span style={{ color: "var(--accent)", marginTop: 1, flexShrink: 0 }}>{icon}</span>
      <span>{children}</span>
    </div>
  );
}
