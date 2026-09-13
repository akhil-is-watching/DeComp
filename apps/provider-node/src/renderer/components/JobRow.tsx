/**
 * One audit record, rendered the same way wherever jobs are listed. Collapsed it answers "what
 * ran, how long, what did it pay"; expanded it hands over the settlement transactions so the
 * payment can be re-checked on Hashscan — the whole point of the audit trail.
 */
import { useState } from "react";
import { HBAR_ASSET, hashscanTxUrl } from "@decomp/hedera-x402";
import type { AuditEntry } from "@decomp/hcs-registry";
import type { Settings } from "../../main/settings-store";
import { Badge } from "./Badge";
import { Copyable } from "./Copyable";
import { ExternalLink } from "./ExternalLink";
import { IconChevron } from "./icons";
import { assetUnit, compact, consensusDate, dateTime, duration, hbar, relativeTime, shortAddress } from "../lib/format";
import { isSuccess } from "../lib/metrics";

export function JobRow({
  entry,
  network,
  computeTokenId,
  now,
  expandable = true,
}: {
  entry: AuditEntry;
  network: Settings["network"];
  computeTokenId: string | null;
  now: number;
  expandable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const at = consensusDate(entry.consensusTimestamp);
  const succeeded = isSuccess(entry);
  const amount = entry.asset === HBAR_ASSET ? hbar(entry.totalPaid, 4) : compact(Number(entry.totalPaid));

  return (
    <div>
      <button
        className="row-button"
        onClick={() => expandable && setOpen(o => !o)}
        aria-expanded={expandable ? open : undefined}
        style={{ padding: "12px 14px", cursor: "default" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {expandable && (
            <IconChevron
              size={12}
              style={{ color: "var(--muted)", transform: open ? "rotate(90deg)" : "none", transition: "transform 160ms var(--ease)" }}
            />
          )}
          <span
            aria-hidden
            style={{ width: 6, height: 6, borderRadius: 999, flexShrink: 0, background: succeeded ? "var(--viz-good)" : "var(--viz-crit)" }}
          />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 }}>
              <span style={{ fontSize: 13.5, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {entry.jobType}
              </span>
              {!succeeded && (
                <span style={{ fontSize: 12, color: "var(--viz-crit)" }}>{entry.status}</span>
              )}
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3 }}>
              {duration(entry.wallClockS)} · {entry.transactions.length} tick{entry.transactions.length === 1 ? "" : "s"} · {relativeTime(at, now)}
            </div>
          </div>
          <div style={{ textAlign: "right", flexShrink: 0 }}>
            <div className="tabular" style={{ fontSize: 14, color: "var(--text)" }}>
              {amount}
              <span style={{ color: "var(--muted-bright)", marginLeft: 5, fontSize: 12 }}>{assetUnit(entry.asset, computeTokenId)}</span>
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3 }}>{shortAddress(entry.agent, 10, 4)}</div>
          </div>
        </div>
      </button>

      {open && (
        <div className="rise" style={{ padding: "2px 14px 16px 44px", display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
            <Fact label="Completed">{dateTime(at)}</Fact>
            <Fact label="Paid by">
              <Copyable value={entry.agent}>{shortAddress(entry.agent, 10, 4)}</Copyable>
            </Fact>
            <Fact label="Tick size">{entry.tickSeconds}s</Fact>
            <Fact label="Status">
              <Badge tone={succeeded ? "good" : "crit"} uppercase={false}>
                {entry.status}
              </Badge>
            </Fact>
            <Fact label="Job id">
              <Copyable value={entry.jobId}>{shortAddress(entry.jobId, 8, 4)}</Copyable>
            </Fact>
            <Fact label="Audit seq">#{entry.sequenceNumber}</Fact>
          </div>
          <div>
            <div style={{ fontSize: 11.5, letterSpacing: "0.09em", textTransform: "uppercase", color: "var(--muted)", marginBottom: 7 }}>
              Settlement transactions
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {entry.transactions.map((tx, index) => (
                <div key={tx} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12 }}>
                  <span className="tabular" style={{ color: "var(--muted)", width: 26, flexShrink: 0 }}>
                    {index + 1}.
                  </span>
                  <ExternalLink href={hashscanTxUrl(tx, network)}>
                    <span className="tabular">{tx}</span>
                  </ExternalLink>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 11.5, letterSpacing: "0.09em", textTransform: "uppercase", color: "var(--muted)" }}>{label}</div>
      <div style={{ fontSize: 13, marginTop: 4, color: "var(--muted-bright)", overflow: "hidden", textOverflow: "ellipsis" }}>{children}</div>
    </div>
  );
}
