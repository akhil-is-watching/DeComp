/**
 * Every job this node has been paid for, as recorded on the audit topic. One filter row scopes
 * the whole screen — the summary strip and the list both re-read the same slice.
 */
import { useMemo, useState } from "react";
import { HBAR_ASSET } from "@decomp/hedera-x402";
import type { AuditEntry } from "@decomp/hcs-registry";
import { Card, SectionTitle } from "../components/Surface";
import { EmptyState } from "../components/EmptyState";
import { ExternalLink } from "../components/ExternalLink";
import { JobRow } from "../components/JobRow";
import { Skeleton } from "../components/Skeleton";
import { IconLayers, IconSearch } from "../components/icons";
import { useAppData } from "../state/AppData";
import { useNow } from "../hooks/useNow";
import { compact, consensusDate, duration, hbar } from "../lib/format";
import { byJobType, isSuccess, summarize } from "../lib/metrics";
import { NeedsSetup } from "./NeedsSetup";

type Range = 7 | 30 | 0;
const RANGES: { id: Range; label: string }[] = [
  { id: 7, label: "7 days" },
  { id: 30, label: "30 days" },
  { id: 0, label: "All time" },
];

export function Jobs({ onOpenTab }: { onOpenTab: (tab: "settings") => void }) {
  const { settings, audits, initialLoading } = useAppData();
  const now = useNow(30_000);
  const [range, setRange] = useState<Range>(0);
  const [jobType, setJobType] = useState<string | null>(null);
  const [failedOnly, setFailedOnly] = useState(false);
  const [query, setQuery] = useState("");

  const types = useMemo(() => byJobType(audits).map(row => row.jobType), [audits]);

  const filtered = useMemo(() => {
    const cutoff = range === 0 ? 0 : Date.now() - range * 86_400_000;
    const needle = query.trim().toLowerCase();
    return audits.filter((entry: AuditEntry) => {
      if (consensusDate(entry.consensusTimestamp).getTime() < cutoff) return false;
      if (jobType && entry.jobType !== jobType) return false;
      if (failedOnly && isSuccess(entry)) return false;
      if (needle && !`${entry.jobId} ${entry.jobType} ${entry.agent} ${entry.status}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [audits, range, jobType, failedOnly, query]);

  const scoped = useMemo(() => summarize(filtered), [filtered]);

  if (!settings) return null;
  if (!settings.accountId || !settings.auditTopicId) {
    return (
      <NeedsSetup
        title="No audit topic configured"
        body="Jobs are read from the HCS audit topic agents publish to. This deployment has no audit topic set in its .env, so there's nothing to read yet — Settings shows what this node is currently pointed at."
        onOpenTab={onOpenTab}
      />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1 className="font-serif" style={{ margin: 0, fontSize: 32, letterSpacing: "-0.01em" }}>
            Jobs
          </h1>
          <p style={{ margin: "6px 0 0", color: "var(--muted)", fontSize: 13.5 }}>
            Every job an agent paid this node for, as published on the audit topic
          </p>
        </div>
        {settings.auditTopicId && (
          <ExternalLink href={`https://hashscan.io/${settings.network.split(":")[1]}/topic/${settings.auditTopicId}`}>
            Audit topic {settings.auditTopicId}
          </ExternalLink>
        )}
      </div>

      {/* one filter row above everything it scopes */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: "1 1 200px", maxWidth: 280 }}>
          <IconSearch size={13} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--muted)" }} />
          <input
            className="field selectable"
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Search job, agent, status"
            style={{ paddingLeft: 30 }}
          />
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {RANGES.map(option => (
            <button key={option.id} className="chip" aria-pressed={range === option.id} onClick={() => setRange(option.id)}>
              {option.label}
            </button>
          ))}
        </div>
        {types.length > 1 && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button className="chip" aria-pressed={jobType === null} onClick={() => setJobType(null)}>
              All types
            </button>
            {types.map(type => (
              <button key={type} className="chip" aria-pressed={jobType === type} onClick={() => setJobType(type)}>
                {type}
              </button>
            ))}
          </div>
        )}
        {audits.some(entry => !isSuccess(entry)) && (
          <button className="chip" aria-pressed={failedOnly} onClick={() => setFailedOnly(f => !f)}>
            Unfinished only
          </button>
        )}
      </div>

      <Card padding="14px 18px">
        <div style={{ display: "flex", gap: 28, flexWrap: "wrap" }}>
          <Figure label="Jobs" value={String(scoped.jobs)} sub={scoped.failed > 0 ? `${scoped.failed} unfinished` : "all completed"} />
          <Figure label="GPU time" value={duration(scoped.gpuSeconds)} sub={scoped.avgJobSeconds ? `${duration(scoped.avgJobSeconds)} avg` : "—"} />
          <Figure label="Earned" value={`${hbar(scoped.hbarTotal, 4)} ℏ`} sub={`${scoped.settlements} settlements`} />
          {scoped.byAsset
            .filter(row => row.asset !== HBAR_ASSET)
            .map(row => (
              <Figure key={row.asset} label="Earned (token)" value={`${compact(Number(row.total))} DCC`} sub={`${row.jobs} job${row.jobs === 1 ? "" : "s"}`} />
            ))}
          <Figure label="Agents" value={String(scoped.uniqueAgents)} sub={scoped.jobTypes === 1 ? "1 job type" : `${scoped.jobTypes} job types`} />
        </div>
      </Card>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <SectionTitle>{filtered.length === audits.length ? `${audits.length} jobs` : `${filtered.length} of ${audits.length} jobs`}</SectionTitle>
        <Card padding={filtered.length === 0 ? 0 : 6}>
          {initialLoading ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: 14 }}>
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} height={20} width={`${100 - i * 9}%`} />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={<IconLayers size={17} />}
              title={audits.length === 0 ? "No jobs served yet" : "Nothing matches those filters"}
              body={
                audits.length === 0
                  ? "An agent discovers this node on the registry, pays per five-second tick, and publishes an audit record when the job ends. That record is what shows up here."
                  : "Widen the time range or clear the search to see more."
              }
            />
          ) : (
            <div className="divide">
              {filtered.map(entry => (
                <JobRow key={entry.jobId} entry={entry} network={settings.network} computeTokenId={settings.computeTokenId} now={now} />
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function Figure({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div>
      <div style={{ fontSize: 11.5, letterSpacing: "0.09em", textTransform: "uppercase", color: "var(--muted)" }}>{label}</div>
      <div className="font-serif" style={{ fontSize: 24, marginTop: 5, lineHeight: 1 }}>
        {value}
      </div>
      <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 5 }}>{sub}</div>
    </div>
  );
}
