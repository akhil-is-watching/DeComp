import { useEffect, useState } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { Card } from "../components/Card";
import { Button } from "../components/Button";
import { useSettings } from "../hooks/useSettings";
import type { Settings as SettingsType } from "../../main/settings-store";

const FIELD_STYLE: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid var(--line)",
  background: "color-mix(in srgb, var(--text) 3%, transparent)",
  color: "var(--text)",
  fontFamily: "inherit",
  fontSize: 13,
  outline: "none",
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ color: "var(--muted)", fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase" }}>{label}</span>
      {children}
    </label>
  );
}

export function SettingsScreen() {
  const { settings, save } = useSettings();
  const { wallets } = useWallets();
  const { authenticated } = usePrivy();
  const [draft, setDraft] = useState<SettingsType | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => setDraft(settings), [settings]);

  const embeddedWallet = wallets.find(w => w.walletClientType === "privy");

  if (!draft) return <p style={{ color: "var(--muted)" }}>loading…</p>;

  function update<K extends keyof SettingsType>(key: K, value: SettingsType[K]) {
    setDraft(d => (d ? { ...d, [key]: value } : d));
    setSaved(false);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 520 }}>
      {authenticated && embeddedWallet && draft.embeddedWalletAddress !== embeddedWallet.address && (
        <Card style={{ padding: 14, borderColor: "var(--accent)" }}>
          <span style={{ color: "var(--muted)", fontSize: 12 }}>
            Logged in wallet ({embeddedWallet.address.slice(0, 10)}…) isn't saved yet.{" "}
            <a
              href="#"
              onClick={e => {
                e.preventDefault();
                update("embeddedWalletAddress", embeddedWallet.address);
              }}
              style={{ color: "var(--accent)" }}
            >
              use it
            </a>
          </span>
        </Card>
      )}

      <Card style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <Field label="Hedera account id (created automatically on first login)">
          <input style={FIELD_STYLE} value={draft.accountId ?? ""} onChange={e => update("accountId", e.target.value || null)} placeholder="0.0.xxxxxxx" />
        </Field>
        <Field label="Provider name">
          <input style={FIELD_STYLE} value={draft.providerName} onChange={e => update("providerName", e.target.value)} />
        </Field>
        <Field label="Network">
          <select style={FIELD_STYLE} value={draft.network} onChange={e => update("network", e.target.value as SettingsType["network"])}>
            <option value="hedera:testnet">hedera:testnet</option>
            <option value="hedera:mainnet">hedera:mainnet</option>
          </select>
        </Field>
        <Field label="Registry topic id">
          <input style={FIELD_STYLE} value={draft.registryTopicId ?? ""} onChange={e => update("registryTopicId", e.target.value || null)} placeholder="0.0.xxxxxxx" />
        </Field>
        <Field label="Audit topic id">
          <input style={FIELD_STYLE} value={draft.auditTopicId ?? ""} onChange={e => update("auditTopicId", e.target.value || null)} placeholder="0.0.xxxxxxx" />
        </Field>
        <Field label="Compute token id (optional)">
          <input style={FIELD_STYLE} value={draft.computeTokenId ?? ""} onChange={e => update("computeTokenId", e.target.value || null)} placeholder="0.0.xxxxxxx" />
        </Field>
        <Field label="Also associate on provisioning (comma-separated, optional)">
          <input
            style={FIELD_STYLE}
            value={draft.associateTokenIds.join(", ")}
            onChange={e =>
              update(
                "associateTokenIds",
                e.target.value.split(",").map(s => s.trim()).filter(Boolean),
              )
            }
            placeholder="0.0.429274"
          />
        </Field>
        <Field label="Bridge URL (optional — leave empty to expose this machine directly)">
          <input style={FIELD_STYLE} value={draft.bridgeUrl ?? ""} onChange={e => update("bridgeUrl", e.target.value || null)} placeholder="https://…" />
        </Field>
        <Field label="GPU runner checkout path">
          <input style={FIELD_STYLE} value={draft.runnerPath ?? ""} onChange={e => update("runnerPath", e.target.value || null)} placeholder="/path/to/DeComp/services/job-runner" />
        </Field>
      </Card>

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Button
          onClick={async () => {
            await save(draft);
            setSaved(true);
          }}
        >
          save
        </Button>
        {saved && <span style={{ color: "var(--accent)", fontSize: 12 }}>saved</span>}
      </div>
    </div>
  );
}
