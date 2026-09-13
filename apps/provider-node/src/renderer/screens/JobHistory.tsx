import { formatTinybars, HBAR_ASSET, hashscanTxUrl } from "@decomp/hedera-x402";
import { Card } from "../components/Card";
import { useAuditHistory } from "../hooks/useAuditHistory";
import { useSettings } from "../hooks/useSettings";

function describeAmount(asset: string, amount: string): string {
  return asset === HBAR_ASSET ? formatTinybars(amount) : `${amount} units of ${asset}`;
}

export function JobHistory() {
  const { settings } = useSettings();
  const { loading, error, entries } = useAuditHistory(settings?.auditTopicId ?? null, settings?.accountId ?? null);

  if (!settings) return <p style={{ color: "var(--muted)" }}>loading…</p>;
  if (!settings.accountId || !settings.auditTopicId) {
    return <p style={{ color: "var(--muted)" }}>Set your account id and audit topic in Settings to see job history.</p>;
  }
  if (loading) return <p style={{ color: "var(--muted)" }}>loading…</p>;
  if (error) return <p style={{ color: "#ff6b6b" }}>{error}</p>;
  if (entries.length === 0) return <p style={{ color: "var(--muted)" }}>No jobs served yet.</p>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {entries.map(entry => (
        <Card key={entry.jobId} style={{ padding: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
            <span style={{ color: "var(--text)" }}>{entry.jobType}</span>
            <span style={{ color: "var(--accent)", fontSize: 13 }}>{describeAmount(entry.asset, entry.totalPaid)}</span>
          </div>
          <div style={{ color: "var(--muted)", fontSize: 11, marginTop: 6 }}>
            {entry.wallClockS}s · {entry.status} · paid by {entry.agent}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
            {entry.transactions.map(tx => (
              <a
                key={tx}
                href={hashscanTxUrl(tx, settings.network)}
                target="_blank"
                rel="noreferrer"
                style={{ color: "var(--muted-bright)", fontSize: 11 }}
              >
                {tx}
              </a>
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}
