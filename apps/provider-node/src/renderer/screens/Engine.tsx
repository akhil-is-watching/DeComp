/**
 * Start, stop, and watch the two local processes that make this node actually answer jobs — the
 * GPU runner (services/job-runner) and the provider (apps/provider). Being listed on the registry
 * (see GoLive.tsx) only advertises an endpoint; this is what makes something answer there.
 */
import { useEffect, useRef, useState } from "react";
import { Card, DetailRow, SectionTitle } from "../components/Surface";
import { Badge } from "../components/Badge";
import { EmptyState } from "../components/EmptyState";
import { ServingStatus } from "../components/NodeStatus";
import { IconAlert, IconCheck, IconCpu, IconTable } from "../components/icons";
import { useAppData } from "../state/AppData";
import { useNodeRun } from "../hooks/useNodeRun";

export function Engine({ onOpenTab }: { onOpenTab: (tab: "settings") => void }) {
  const { settings } = useAppData();
  const node = useNodeRun();
  const pathCheck = useRunnerPathCheck(settings?.runnerPath ?? null, node.state.running);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [node.log]);

  if (!settings) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22, maxWidth: 900 }}>
      <div>
        <h1 className="font-serif" style={{ margin: 0, fontSize: 32, letterSpacing: "-0.01em" }}>
          Engine
        </h1>
        <p style={{ margin: "6px 0 0", color: "var(--muted)", fontSize: 13.5, lineHeight: 1.7 }}>
          Runs the job runner and the provider as child processes of this app. Stopping the app
          stops them too — nothing keeps answering jobs it can no longer get signatures for.
        </p>
      </div>

      <ServingStatus run={node.state} busy={node.busy} onStart={() => void node.start()} onStop={() => void node.stop()} />

      <Card title="GPU runner checkout" padding={18} action={<button className="link" onClick={() => onOpenTab("settings")}>Edit in Settings</button>}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 11 }}>
          {pathCheck === null ? (
            <span style={{ fontSize: 13, color: "var(--muted)" }}>checking…</span>
          ) : pathCheck.ok ? (
            <>
              <IconCheck size={15} style={{ color: "var(--viz-good)", flexShrink: 0, marginTop: 2 }} />
              <span className="mono" style={{ fontSize: 12.5, color: "var(--muted-bright)", lineHeight: 1.7, wordBreak: "break-all" }}>
                {pathCheck.message}
              </span>
            </>
          ) : (
            <>
              <IconAlert size={15} style={{ color: "var(--viz-warn)", flexShrink: 0, marginTop: 2 }} />
              <span style={{ fontSize: 12.5, color: "var(--muted-bright)", lineHeight: 1.7, wordBreak: "break-all" }}>{pathCheck.message}</span>
            </>
          )}
        </div>
      </Card>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <SectionTitle
          action={
            <Badge tone="neutral" uppercase={false}>
              {node.log.length} line{node.log.length === 1 ? "" : "s"}
            </Badge>
          }
        >
          Runner &amp; provider log
        </SectionTitle>
        <Card padding={0}>
          <div
            ref={logRef}
            className="mono"
            style={{
              maxHeight: 420,
              overflowY: "auto",
              padding: node.log.length === 0 ? 0 : "12px 16px",
              fontSize: 12,
              lineHeight: 1.75,
            }}
          >
            {node.log.length === 0 ? (
              <EmptyState
                icon={<IconTable size={16} />}
                title="No output yet"
                body="Log lines from the runner and provider processes show up here once the node is started."
              />
            ) : (
              node.log.map((entry, i) => (
                <div key={i} style={{ display: "flex", gap: 10, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                  <span style={{ color: "var(--muted)", flexShrink: 0 }}>{new Date(entry.at).toLocaleTimeString()}</span>
                  <span style={{ color: entry.name === "runner" ? "var(--viz-good)" : "var(--accent)", flexShrink: 0 }}>
                    {entry.name}
                  </span>
                  <span style={{ color: "var(--muted-bright)", minWidth: 0 }}>{entry.line}</span>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>

      <Card title="Processes" padding={18}>
        <div className="divide">
          <DetailRow label="Job runner">
            <ProcessBadge status={node.state.runner} />
          </DetailRow>
          <DetailRow label="Provider">
            <ProcessBadge status={node.state.provider} />
          </DetailRow>
          <DetailRow label="Reachable via bridge">
            {node.state.reachableAt ? <span className="mono">{node.state.reachableAt}</span> : <span style={{ color: "var(--muted)" }}>—</span>}
          </DetailRow>
          <DetailRow label="GPU icon" align="right">
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--muted)" }}>
              <IconCpu size={13} /> Apple GPU only — the runner refuses to run on CPU
            </span>
          </DetailRow>
        </div>
      </Card>
    </div>
  );
}

function ProcessBadge({ status }: { status: "stopped" | "starting" | "ready" | "failed" }) {
  const tone = status === "ready" ? "good" : status === "failed" ? "crit" : status === "starting" ? "warn" : "neutral";
  return (
    <Badge tone={tone} dot pulse={status === "starting"}>
      {status}
    </Badge>
  );
}

type PathCheck = { ok: boolean; message: string };

/** Mirrors what Start will do, re-checked whenever the path or run state changes so a fixed path clears the warning without a restart. */
function useRunnerPathCheck(runnerPath: string | null, running: boolean): PathCheck | null {
  const [result, setResult] = useState<PathCheck | null>(null);

  useEffect(() => {
    let cancelled = false;
    void window.decomp.checkRunnerPath(runnerPath).then(status => {
      if (!cancelled) setResult(status);
    });
    return () => {
      cancelled = true;
    };
  }, [runnerPath, running]);

  return result;
}
