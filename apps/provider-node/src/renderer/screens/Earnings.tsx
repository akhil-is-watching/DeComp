/**
 * The money view: what's in the account now, what has been earned over time, and who paid it.
 * Merges what used to be two near-empty tabs (Balance and Reward History) — a balance alone was
 * never a screen's worth of information.
 */
import { useMemo, useState } from "react";
import { HBAR_ASSET } from "@decomp/hedera-x402";
import { BarChart, type BarDatum } from "../components/BarChart";
import { Card, DetailRow, SectionTitle } from "../components/Surface";
import { Copyable } from "../components/Copyable";
import { EmptyState } from "../components/EmptyState";
import { ExternalLink } from "../components/ExternalLink";
import { Stat } from "../components/Stat";
import { Skeleton } from "../components/Skeleton";
import { IconCoins, IconWallet } from "../components/icons";
import { useAppData } from "../state/AppData";
import { assetName, assetUnit, compact, dayLabel, duration, hbar, hbarFloat, percentChange, shortAddress } from "../lib/format";
import { byJobType, dailyTotals, summarize, windowTotals } from "../lib/metrics";
import { NeedsSetup } from "./NeedsSetup";

const RANGES = [7, 14, 30] as const;
type Range = (typeof RANGES)[number];

export function Earnings({ onOpenTab }: { onOpenTab: (tab: "settings") => void }) {
  const { settings, balance, audits, initialLoading, error } = useAppData();
  const [range, setRange] = useState<Range>(14);

  const summary = useMemo(() => summarize(audits), [audits]);
  const days = useMemo(() => dailyTotals(audits, HBAR_ASSET, range), [audits, range]);
  const window = useMemo(() => windowTotals(audits, HBAR_ASSET, range), [audits, range]);
  const topAgents = useMemo(() => rankAgents(audits), [audits]);
  const revenueByType = useMemo(() => byJobType(audits), [audits]);

  if (!settings) return null;
  if (!settings.accountId) {
    return (
      <NeedsSetup
        title="No Hedera account yet"
        body="Earnings are read from this node's own Hedera account and the audit topic. The account is created automatically on first sign-in; if it's missing, signing out and back in will try again."
        onOpenTab={onOpenTab}
      />
    );
  }

  const explorer = `https://hashscan.io/${settings.network.split(":")[1]}`;
  const bars: BarDatum[] = days.map(bucket => ({
    key: bucket.key,
    label: dayLabel(bucket.day),
    value: hbarFloat(bucket.total),
    caption: bucket.jobs === 0 ? "no jobs" : `${bucket.jobs} job${bucket.jobs === 1 ? "" : "s"}`,
  }));
  const delta = percentChange(window.current, window.previous);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <h1 className="font-serif" style={{ margin: 0, fontSize: 32, letterSpacing: "-0.01em" }}>
          Earnings
        </h1>
        <p style={{ margin: "6px 0 0", color: "var(--muted)", fontSize: 13.5 }}>
          Balances read from the mirror node; earnings rebuilt from the audit topic
        </p>
      </div>

      {error && (
        <Card padding="12px 16px" style={{ borderColor: "color-mix(in srgb, var(--viz-crit) 40%, transparent)" }}>
          <span style={{ color: "var(--viz-crit)", fontSize: 13 }}>{error}</span>
        </Card>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 14 }}>
        <Stat
          label="HBAR balance"
          icon={<IconWallet size={13} />}
          value={balance ? hbar(balance.hbarTinybars, 4) : "—"}
          unit="ℏ"
          loading={initialLoading}
          footer={<Copyable value={settings.accountId} />}
        />
        {settings.computeTokenId && (
          <Stat
            label="Compute token"
            icon={<IconCoins size={13} />}
            value={balance?.computeTokenUnits ? compact(Number(balance.computeTokenUnits)) : balance ? "—" : "…"}
            unit={balance?.computeTokenUnits ? "DCC" : undefined}
            loading={initialLoading}
            footer={balance && balance.computeTokenUnits === null ? "not associated with this account" : settings.computeTokenId}
          />
        )}
        <Stat
          label={`Earned · last ${range} days`}
          value={hbar(window.current, 2)}
          unit="ℏ"
          loading={initialLoading}
          delta={delta === null ? null : { value: delta, label: `vs previous ${range}d` }}
          footer={delta === null && window.current > 0n ? "no earlier period to compare" : undefined}
        />
        <Stat
          label="Lifetime earned"
          value={hbar(summary.hbarTotal, 2)}
          unit="ℏ"
          loading={initialLoading}
          footer={summary.jobs === 0 ? "no jobs yet" : `${summary.jobs} jobs · ${duration(summary.gpuSeconds)} of GPU time`}
        />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <SectionTitle
          action={
            <div style={{ display: "flex", gap: 6 }}>
              {RANGES.map(option => (
                <button key={option} className="chip" aria-pressed={range === option} onClick={() => setRange(option)}>
                  {option}d
                </button>
              ))}
            </div>
          }
        >
          HBAR earned per day
        </SectionTitle>
        <Card padding="26px 22px 18px">
          {initialLoading ? <Skeleton height={150} /> : <BarChart data={bars} formatValue={format} unit="ℏ" tableHeaders={["Day", "HBAR"]} />}
        </Card>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16, alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <SectionTitle>Who pays for this GPU</SectionTitle>
          <Card padding={topAgents.length === 0 ? 0 : 18}>
            {topAgents.length === 0 ? (
              <EmptyState icon={<IconCoins size={17} />} title="No payers yet" body="Agents that buy time from this node are listed here, biggest first." />
            ) : (
              <div className="divide">
                {topAgents.map(agent => (
                  <DetailRow
                    key={agent.account}
                    label={
                      <ExternalLink href={`${explorer}/account/${agent.account}`}>
                        <span className="tabular">{shortAddress(agent.account, 10, 4)}</span>
                      </ExternalLink>
                    }
                  >
                    <span className="tabular">
                      {hbar(agent.hbar, 4)} ℏ
                      <span style={{ color: "var(--muted)" }}>
                        {" · "}
                        {agent.jobs} job{agent.jobs === 1 ? "" : "s"}
                      </span>
                    </span>
                  </DetailRow>
                ))}
              </div>
            )}
          </Card>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <SectionTitle>Revenue by job type</SectionTitle>
          <Card padding={revenueByType.length === 0 ? 0 : 18}>
            {revenueByType.length === 0 ? (
              <EmptyState icon={<IconCoins size={17} />} title="Nothing sold yet" body="Each job type this node has been paid for is broken out here." />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {revenueByType.map(row => (
                  <RevenueBar key={row.jobType} row={row} max={revenueByType.reduce((m, r) => (r.hbar > m ? r.hbar : m), 0n)} />
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>

      {summary.byAsset.length > 1 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <SectionTitle>By asset</SectionTitle>
          <Card padding={18}>
            <div className="divide">
              {summary.byAsset.map(row => (
                <DetailRow key={row.asset} label={assetName(row.asset, settings.computeTokenId)}>
                  <span className="tabular">
                    {row.asset === HBAR_ASSET ? hbar(row.total, 4) : compact(Number(row.total))} {assetUnit(row.asset, settings.computeTokenId)}
                    <span style={{ color: "var(--muted)" }}>
                      {" · "}
                      {row.jobs} job{row.jobs === 1 ? "" : "s"}
                    </span>
                  </span>
                </DetailRow>
              ))}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

/** A meter, not a chart: one value against the biggest one, on the same hue. */
function RevenueBar({ row, max }: { row: { jobType: string; jobs: number; seconds: number; hbar: bigint }; max: bigint }) {
  const fraction = max > 0n ? Number((row.hbar * 1000n) / max) / 1000 : 0;
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, marginBottom: 7 }}>
        <span style={{ fontSize: 13, color: "var(--text)" }}>{row.jobType}</span>
        <span className="tabular" style={{ fontSize: 13 }}>
          {hbar(row.hbar, 4)} ℏ
          <span style={{ color: "var(--muted)" }}>
            {" · "}
            {duration(row.seconds)}
          </span>
        </span>
      </div>
      <div style={{ height: 6, borderRadius: 999, background: "var(--viz-track)", overflow: "hidden" }}>
        <div style={{ width: `${Math.max(fraction * 100, row.hbar > 0n ? 2 : 0)}%`, height: "100%", borderRadius: 999, background: "var(--viz-series-1)" }} />
      </div>
    </div>
  );
}

function rankAgents(audits: { agent: string; asset: string; totalPaid: string }[]): { account: string; hbar: bigint; jobs: number }[] {
  const map = new Map<string, { account: string; hbar: bigint; jobs: number }>();
  for (const entry of audits) {
    const row = map.get(entry.agent) ?? { account: entry.agent, hbar: 0n, jobs: 0 };
    if (entry.asset === HBAR_ASSET) row.hbar += BigInt(entry.totalPaid);
    row.jobs += 1;
    map.set(entry.agent, row);
  }
  return [...map.values()].sort((a, b) => (b.hbar > a.hbar ? 1 : b.hbar < a.hbar ? -1 : 0)).slice(0, 6);
}

function format(value: number): string {
  return value >= 1 ? value.toFixed(1) : value.toFixed(3);
}
