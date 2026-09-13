/**
 * The landing screen. Everything here is derived from the audit records the agent published on
 * HCS and the account's mirror-node balance — see lib/metrics.ts. A number that can't be computed
 * from those isn't shown.
 */
import { useMemo } from "react";
import { HBAR_ASSET } from "@decomp/hedera-x402";
import type { NodeRunState } from "../../main/node-supervisor";
import { Badge } from "../components/Badge";
import { BarChart, type BarDatum } from "../components/BarChart";
import { Card, DetailRow, SectionTitle } from "../components/Surface";
import { Copyable } from "../components/Copyable";
import { EmptyState } from "../components/EmptyState";
import { ExternalLink } from "../components/ExternalLink";
import { Stat } from "../components/Stat";
import { JobRow } from "../components/JobRow";
import { NodeStatus } from "../components/NodeStatus";
import { Skeleton } from "../components/Skeleton";
import { IconBolt, IconCpu, IconLayers, IconWallet } from "../components/icons";
import { useAppData } from "../state/AppData";
import { useNow } from "../hooks/useNow";
import { useNodeRun } from "../hooks/useNodeRun";
import { assetUnit, compact, dayLabel, duration, greeting, hbar, hbarFloat, percentChange, relativeTime, shortAddress } from "../lib/format";
import { byJobType, countInWindow, dailyTotals, marketPosition, summarize, windowTotals } from "../lib/metrics";

const TREND_DAYS = 14;

export function Overview({ onOpenTab, onGoLive }: { onOpenTab: (tab: "engine" | "jobs" | "earnings" | "settings") => void; onGoLive: () => void }) {
  const { settings, balance, audits, registry, initialLoading } = useAppData();
  const now = useNow(30_000);
  const node = useNodeRun();

  const summary = useMemo(() => summarize(audits), [audits]);
  const market = useMemo(() => marketPosition(registry, settings?.accountId ?? null), [registry, settings?.accountId]);
  const days = useMemo(() => dailyTotals(audits, HBAR_ASSET, TREND_DAYS), [audits]);
  const week = useMemo(() => windowTotals(audits, HBAR_ASSET, 7), [audits]);
  const jobTypes = useMemo(() => byJobType(audits), [audits]);

  if (!settings) return null;

  const bars: BarDatum[] = days.map(bucket => ({
    key: bucket.key,
    label: dayLabel(bucket.day),
    value: hbarFloat(bucket.total),
    caption: bucket.jobs === 0 ? "no jobs" : `${bucket.jobs} job${bucket.jobs === 1 ? "" : "s"}`,
  }));
  const weekDelta = percentChange(week.current, week.previous);
  const recent = audits.slice(0, 5);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      <PageHeader providerName={settings.providerName} lastJobAt={summary.lastJobAt} now={now} />

      <NodeStatus listing={market.listing} competitors={market.competitors} onGoLive={onGoLive} />

      {/* Listed is not the same as serving; both have to be true before a job can land. Full
          start/stop control and logs live on the Engine tab — this is just enough to notice. */}
      {market.listing && <ServingSummary run={node.state} onOpenEngine={() => onOpenTab("engine")} />}

      {/* --- hero: the one number this app exists to report, and its shape over time --- */}
      <Card padding={0} style={{ overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(240px, 0.8fr) minmax(320px, 1.4fr)", gap: 0 }}>
          <div style={{ padding: 24, display: "flex", flexDirection: "column", justifyContent: "center", gap: 14, borderRight: "1px solid var(--line)" }}>
            <span style={{ fontSize: 11.5, letterSpacing: "0.09em", textTransform: "uppercase", color: "var(--muted)" }}>Lifetime earnings</span>
            {initialLoading ? (
              <Skeleton width="80%" height={52} />
            ) : (
              <div className="font-serif" style={{ fontSize: 58, lineHeight: 1, letterSpacing: "-0.02em" }}>
                {hbar(summary.hbarTotal, 2)}
                <span style={{ fontFamily: "inherit", fontSize: 24, color: "var(--muted-bright)", marginLeft: 8 }}>ℏ</span>
              </div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              <span style={{ fontSize: 13, color: "var(--muted-bright)" }}>
                {summary.jobs === 0
                  ? "No paid jobs yet"
                  : `across ${summary.jobs} job${summary.jobs === 1 ? "" : "s"} for ${summary.uniqueAgents} agent${summary.uniqueAgents === 1 ? "" : "s"}`}
              </span>
              <span style={{ fontSize: 13, color: "var(--muted)" }}>
                {hbar(week.current, 2)} ℏ in the last 7 days
                {weekDelta !== null && (
                  <span style={{ color: weekDelta >= 0 ? "var(--viz-good)" : "var(--viz-crit)", marginLeft: 8 }}>
                    {weekDelta >= 0 ? "▲" : "▼"} {Math.abs(weekDelta).toFixed(0)}% vs the week before
                  </span>
                )}
              </span>
              {summary.byAsset
                .filter(row => row.asset !== HBAR_ASSET)
                .map(row => (
                  <span key={row.asset} style={{ fontSize: 13, color: "var(--muted)" }}>
                    + {compact(Number(row.total))} {assetUnit(row.asset, settings.computeTokenId)} across {row.jobs} job{row.jobs === 1 ? "" : "s"}
                  </span>
                ))}
            </div>
          </div>
          <div style={{ padding: "20px 24px 16px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18, minHeight: 30 }}>
              <span style={{ fontSize: 11.5, letterSpacing: "0.09em", textTransform: "uppercase", color: "var(--muted)" }}>
                Earned per day · last {TREND_DAYS} days
              </span>
            </div>
            <BarChart data={bars} formatValue={value => (value >= 1 ? value.toFixed(1) : value.toFixed(3))} unit="ℏ" tableHeaders={["Day", "HBAR"]} />
          </div>
        </div>
      </Card>

      {/* --- the four numbers worth knowing without clicking anything --- */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 14 }}>
        <Stat
          label="Available balance"
          icon={<IconWallet size={13} />}
          value={balance ? hbar(balance.hbarTinybars, 2) : "—"}
          unit="ℏ"
          loading={initialLoading}
          footer={
            settings.computeTokenId
              ? balance?.computeTokenUnits
                ? `${compact(Number(balance.computeTokenUnits))} DCC`
                : "DCC not associated"
              : "HBAR only"
          }
        />
        <Stat
          label="Jobs served"
          icon={<IconLayers size={13} />}
          value={summary.jobs}
          loading={initialLoading}
          trend={days.map(bucket => bucket.jobs)}
          footer={`${countInWindow(audits, 7)} in the last 7 days`}
        />
        <Stat
          label="GPU time sold"
          icon={<IconCpu size={13} />}
          value={duration(summary.gpuSeconds)}
          loading={initialLoading}
          footer={summary.avgJobSeconds === null ? "no jobs yet" : `${duration(summary.avgJobSeconds)} average per job`}
        />
        <Stat
          label="Effective rate"
          icon={<IconBolt size={13} />}
          value={summary.hbarPerGpuHour === null ? "—" : hbar(summary.hbarPerGpuHour, 2)}
          unit={summary.hbarPerGpuHour === null ? undefined : "ℏ/h"}
          loading={initialLoading}
          footer={summary.hbarPerGpuHour === null ? "no HBAR-paid time yet" : `over ${summary.settlements} settlements`}
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(340px, 1.45fr) minmax(300px, 1fr)", gap: 24, alignItems: "start" }}>
        {/* --- recent activity --- */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <SectionTitle
            action={
              audits.length > 0 && (
                <button className="link" onClick={() => onOpenTab("jobs")} style={{ fontSize: 12.5 }}>
                  All {audits.length} jobs →
                </button>
              )
            }
          >
            Recent activity
          </SectionTitle>
          <Card padding={recent.length === 0 ? 0 : 6}>
            {initialLoading ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: 14 }}>
                <Skeleton height={18} />
                <Skeleton height={18} width="82%" />
                <Skeleton height={18} width="64%" />
              </div>
            ) : recent.length === 0 ? (
              <EmptyState
                icon={<IconLayers size={17} />}
                title="No jobs served yet"
                body="When an agent buys GPU time from this node, it publishes an audit record on the job topic — every job, its metered seconds and every settlement transaction show up here."
              />
            ) : (
              <div className="divide">
                {recent.map(entry => (
                  <JobRow key={entry.jobId} entry={entry} network={settings.network} computeTokenId={settings.computeTokenId} now={now} />
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* --- who this node is on the market, and where its money lives --- */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <SectionTitle>This node</SectionTitle>
          <ListingCard market={market} network={settings.network} registryTopicId={settings.registryTopicId} />
          <Card
            title="Identity"
            padding={18}
            action={
              settings.accountId && (
                <ExternalLink href={`https://hashscan.io/${settings.network.split(":")[1]}/account/${settings.accountId}`}>Hashscan</ExternalLink>
              )
            }
          >
            <div className="divide">
              <DetailRow label="Hedera account">
                {settings.accountId ? <Copyable value={settings.accountId} /> : <span style={{ color: "var(--muted)" }}>not provisioned</span>}
              </DetailRow>
              <DetailRow label="Signing wallet">
                {settings.embeddedWalletAddress ? (
                  <Copyable value={settings.embeddedWalletAddress}>{shortAddress(settings.embeddedWalletAddress, 8, 6)}</Copyable>
                ) : (
                  <span style={{ color: "var(--muted)" }}>—</span>
                )}
              </DetailRow>
              <DetailRow label="Network">{settings.network.replace("hedera:", "")}</DetailRow>
            </div>
          </Card>
          {jobTypes.length > 0 && (
            <Card title="Job mix" padding={18}>
              <div className="divide">
                {jobTypes.map(row => (
                  <DetailRow key={row.jobType} label={row.jobType}>
                    <span className="tabular">
                      {row.jobs} job{row.jobs === 1 ? "" : "s"}
                      <span style={{ color: "var(--muted)" }}> · {duration(row.seconds)}</span>
                    </span>
                  </DetailRow>
                ))}
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

/** A one-line pointer to the Engine tab, not a control surface — Start/Stop and logs live there. */
function ServingSummary({ run, onOpenEngine }: { run: NodeRunState; onOpenEngine: () => void }) {
  const serving = run.provider === "ready";
  const tone = serving ? "good" : run.running ? "warn" : "neutral";
  const label = serving ? "Answering jobs" : run.running ? "Starting up…" : "Not answering jobs";
  return (
    <div className="card">
      <button className="row-button" onClick={onOpenEngine} style={{ padding: "12px 20px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Badge tone={tone} dot pulse={run.running && !serving}>
            {label}
          </Badge>
          <span style={{ fontSize: 12.5, color: "var(--muted)", flex: 1 }}>
            {serving ? "the runner and provider are up" : "open the Engine tab to start the runner"}
          </span>
          <span className="link" style={{ fontSize: 12.5 }}>
            Engine →
          </span>
        </div>
      </button>
    </div>
  );
}

function PageHeader({ providerName, lastJobAt, now }: { providerName: string; lastJobAt: Date | null; now: number }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
      <div>
        <h1 className="font-serif" style={{ margin: 0, fontSize: 32, letterSpacing: "-0.01em", lineHeight: 1.2 }}>
          {greeting()}
        </h1>
        <p style={{ margin: "6px 0 0", color: "var(--muted)", fontSize: 13.5 }}>
          {providerName}
          {lastJobAt && <span> · last job {relativeTime(lastJobAt, now)}</span>}
        </p>
      </div>
    </div>
  );
}

function ListingCard({
  market,
  network,
  registryTopicId,
}: {
  market: ReturnType<typeof marketPosition>;
  network: string;
  registryTopicId: string | null;
}) {
  if (!market.listing) {
    return (
      <Card title="Marketplace listing" padding={18}>
        <p style={{ margin: 0, color: "var(--muted)", fontSize: 13, lineHeight: 1.7 }}>
          Nothing published yet. Use <span style={{ color: "var(--muted-bright)" }}>Go live</span> above
          to advertise this node&apos;s endpoint and prices.
        </p>
      </Card>
    );
  }

  const { listing } = market;
  return (
    <Card
      title="Marketplace listing"
      padding={18}
      action={
        registryTopicId && <ExternalLink href={`https://hashscan.io/${network.split(":")[1]}/topic/${registryTopicId}`}>Topic</ExternalLink>
      }
    >
      <div className="divide">
        <DetailRow label="Advertised as">{listing.providerId}</DetailRow>
        <DetailRow label="Endpoint">
          <span title={listing.endpoint}>{listing.endpoint.replace(/^https?:\/\//, "")}</span>
        </DetailRow>
        <DetailRow label="Competing nodes">{market.competitors}</DetailRow>
      </div>
      <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 8 }}>
        {market.ranks.map(rank => (
          <div key={rank.jobType} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <span style={{ fontSize: 13, color: "var(--muted-bright)" }}>{rank.jobType}</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <span className="tabular" style={{ fontSize: 13 }}>
                {hbar(rank.pricePerSecTinybars, 4)} ℏ/s
              </span>
              <Badge tone={rank.rank === 1 ? "good" : "neutral"} uppercase={false}>
                {rank.rank === 1 ? "cheapest" : `#${rank.rank} of ${rank.of}`}
              </Badge>
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}
