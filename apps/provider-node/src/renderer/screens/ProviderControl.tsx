import { useEffect, useState } from "react";
import { useWallets } from "@privy-io/react-auth";
import { Card } from "../components/Card";
import { Button } from "../components/Button";
import { PillBadge } from "../components/PillBadge";
import { LogPane } from "../components/LogPane";
import { useSettings } from "../hooks/useSettings";
import { useProviderStatus } from "../hooks/useProviderStatus";
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

export function ProviderControl() {
  const { settings, save } = useSettings();
  const { wallets } = useWallets();
  const embeddedWallet = wallets.find(w => w.walletClientType === "privy");
  const { status, logs, error, starting, start, stop } = useProviderStatus();
  const [draft, setDraft] = useState<SettingsType | null>(null);

  useEffect(() => setDraft(settings), [settings]);

  if (!draft || !settings) return <p style={{ color: "var(--muted)" }}>loading…</p>;

  function update<K extends keyof SettingsType>(key: K, value: SettingsType[K]) {
    setDraft(d => (d ? { ...d, [key]: value } : d));
  }

  async function handleStart() {
    const accountId = settings?.accountId;
    if (!draft || !embeddedWallet || !accountId) return;
    await save(draft);
    await start({
      accountId,
      address: embeddedWallet.address,
      providerName: draft.providerName,
      port: draft.port,
      offersSpec: draft.offersSpec,
      tickSeconds: draft.tickSeconds,
      tickGraceSeconds: draft.tickGraceSeconds,
      maxRuntimeS: draft.maxRuntimeS,
      jobRunnerUrl: draft.jobRunnerUrl,
      bridgeUrl: draft.bridgeUrl ?? undefined,
      registryTopicId: draft.registryTopicId ?? undefined,
      computeTokenId: draft.computeTokenId ?? undefined,
      network: draft.network,
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 560 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <PillBadge label={status.running ? "running" : "stopped"} tone={status.running ? "accent" : "muted"} pulse={status.running} />
        {status.running ? (
          <Button variant="ghost" onClick={stop}>
            stop
          </Button>
        ) : (
          <Button onClick={handleStart} disabled={starting || !embeddedWallet || !settings.accountId}>
            {starting ? "starting…" : "start provider"}
          </Button>
        )}
      </div>

      {error && <span style={{ color: "#ff6b6b", fontSize: 12 }}>{error}</span>}

      <Card style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <Field label="Offers (jobType:tinybars-per-second, comma-separated)">
          <input style={FIELD_STYLE} value={draft.offersSpec} onChange={e => update("offersSpec", e.target.value)} disabled={status.running} />
        </Field>
        <Field label="Local port">
          <input
            style={FIELD_STYLE}
            type="number"
            value={draft.port}
            onChange={e => update("port", Number(e.target.value))}
            disabled={status.running}
          />
        </Field>
        <Field label="GPU job runner URL">
          <input style={FIELD_STYLE} value={draft.jobRunnerUrl} onChange={e => update("jobRunnerUrl", e.target.value)} disabled={status.running} />
        </Field>
        <Field label="Tick seconds">
          <input
            style={FIELD_STYLE}
            type="number"
            value={draft.tickSeconds}
            onChange={e => update("tickSeconds", Number(e.target.value))}
            disabled={status.running}
          />
        </Field>
        <Field label="Tick grace seconds">
          <input
            style={FIELD_STYLE}
            type="number"
            value={draft.tickGraceSeconds}
            onChange={e => update("tickGraceSeconds", Number(e.target.value))}
            disabled={status.running}
          />
        </Field>
        <Field label="Max job runtime (seconds)">
          <input
            style={FIELD_STYLE}
            type="number"
            value={draft.maxRuntimeS}
            onChange={e => update("maxRuntimeS", Number(e.target.value))}
            disabled={status.running}
          />
        </Field>
      </Card>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span style={{ color: "var(--muted)", fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase" }}>Logs</span>
        <LogPane lines={logs} />
      </div>
    </div>
  );
}
