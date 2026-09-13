import { useEffect, useState } from "react";
import { formatTinybars } from "@decomp/hedera-x402";
import { StatCard } from "../components/StatCard";
import { useSettings } from "../hooks/useSettings";

export function Balance() {
  const { settings } = useSettings();
  const [balance, setBalance] = useState<{ hbarTinybars: string; computeTokenUnits: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!settings?.accountId) return;
    window.decomp
      .getBalance(settings.accountId, settings.computeTokenId ?? undefined)
      .then(setBalance)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [settings?.accountId, settings?.computeTokenId]);

  if (!settings) return <Loading />;
  if (!settings.accountId) return <NeedsAccount />;
  if (error) return <ErrorBox message={error} />;
  if (!balance) return <Loading />;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 18 }}>
      <StatCard label="HBAR balance" value={formatTinybars(balance.hbarTinybars).replace(" ℏ", "")} unit="ℏ" footer={settings.accountId} />
      {settings.computeTokenId && (
        <StatCard
          label="Compute token"
          value={balance.computeTokenUnits ?? "—"}
          unit={balance.computeTokenUnits === null ? undefined : "DCC"}
          footer={balance.computeTokenUnits === null ? "not associated" : settings.computeTokenId}
        />
      )}
    </div>
  );
}

function Loading() {
  return <p style={{ color: "var(--muted)" }}>loading…</p>;
}

function NeedsAccount() {
  return <p style={{ color: "var(--muted)" }}>Set your Hedera account id in Settings to see your balance.</p>;
}

function ErrorBox({ message }: { message: string }) {
  return <p style={{ color: "#ff6b6b" }}>{message}</p>;
}
