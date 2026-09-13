import { useMemo } from "react";
import { formatTinybars, HBAR_ASSET } from "@decomp/hedera-x402";
import { StatCard } from "../components/StatCard";
import { Card } from "../components/Card";
import { useAuditHistory } from "../hooks/useAuditHistory";
import { useSettings } from "../hooks/useSettings";

function describeAmount(asset: string, amount: bigint): string {
  return asset === HBAR_ASSET ? formatTinybars(amount) : `${amount} units of ${asset}`;
}

export function RewardHistory() {
  const { settings } = useSettings();
  const { loading, error, entries } = useAuditHistory(settings?.auditTopicId ?? null, settings?.accountId ?? null);

  const totals = useMemo(() => {
    const byAsset = new Map<string, bigint>();
    for (const entry of entries) byAsset.set(entry.asset, (byAsset.get(entry.asset) ?? 0n) + BigInt(entry.totalPaid));
    return [...byAsset.entries()];
  }, [entries]);

  if (!settings) return <p style={{ color: "var(--muted)" }}>loading…</p>;
  if (!settings.accountId || !settings.auditTopicId) {
    return <p style={{ color: "var(--muted)" }}>Set your account id and audit topic in Settings to see earnings.</p>;
  }
  if (loading) return <p style={{ color: "var(--muted)" }}>loading…</p>;
  if (error) return <p style={{ color: "#ff6b6b" }}>{error}</p>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 18 }}>
        {totals.length === 0 && <p style={{ color: "var(--muted)" }}>No earnings yet.</p>}
        {totals.map(([asset, total]) => (
          <StatCard key={asset} label={asset === HBAR_ASSET ? "earned (HBAR)" : "earned (token)"} value={describeAmount(asset, total)} />
        ))}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {entries.map(entry => (
          <Card key={entry.jobId} style={{ padding: "12px 16px", display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: "var(--muted-bright)", fontSize: 12 }}>{entry.completedAt}</span>
            <span style={{ color: "var(--accent)", fontSize: 13 }}>{describeAmount(entry.asset, BigInt(entry.totalPaid))}</span>
          </Card>
        ))}
      </div>
    </div>
  );
}
