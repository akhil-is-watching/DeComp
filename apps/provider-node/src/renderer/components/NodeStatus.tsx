/**
 * The dashboard's lead: is this Mac earning or not, and the one action that changes it.
 *
 * Loudness is proportional to whether something needs doing. Offline is the state that costs the
 * user money, so it gets an accent-lit panel and a primary button; live is a quiet confirmation
 * with the listing's terms and a secondary way back in. A dashboard that shouts when everything
 * is fine trains people to ignore it.
 */
import type { RegistryEntry } from "@decomp/hcs-registry";
import type { NodeRunState } from "../../main/node-supervisor";
import { Button } from "./Button";
import { IconBolt, IconBroadcast, IconCpu } from "./icons";
import { hbar } from "../lib/format";

export function NodeStatus({
  listing,
  competitors,
  onGoLive,
}: {
  listing: RegistryEntry | null;
  competitors: number;
  onGoLive: () => void;
}) {
  if (!listing) return <Offline onGoLive={onGoLive} />;

  const price = listing.jobTypes[0]?.pricePerSecTinybars;
  return (
    <div
      className="card"
      style={{
        padding: "16px 20px",
        display: "flex",
        alignItems: "center",
        gap: 16,
        flexWrap: "wrap",
        borderColor: "color-mix(in srgb, var(--viz-good) 26%, transparent)",
      }}
    >
      <span
        aria-hidden
        style={{
          width: 8,
          height: 8,
          borderRadius: 999,
          background: "var(--viz-good)",
          flexShrink: 0,
          animation: "decomp-breathe 2.6s ease-in-out infinite",
        }}
      />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 15, color: "var(--text)" }}>Live on the market</div>
        <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 3 }}>
          Listed as <span style={{ color: "var(--muted-bright)" }}>{listing.providerId}</span>
          {" · "}
          {listing.jobTypes.map(job => job.name).join(", ")}
          {price && (
            <>
              {" · "}
              <span className="tabular">{hbar(price, 4)} ℏ/s</span>
            </>
          )}
          {competitors > 0 && ` · ${competitors} other node${competitors === 1 ? "" : "s"} competing`}
        </div>
      </div>
      <button className="chip" onClick={onGoLive} style={{ flexShrink: 0 }}>
        Update listing
      </button>
    </div>
  );
}

/**
 * Being listed and being able to serve are different things — this is the second one. A listing
 * with nothing answering behind it just makes agents fail a health check and route elsewhere.
 */
export function ServingStatus({ run, busy, onStart, onStop }: { run: NodeRunState; busy: boolean; onStart: () => void; onStop: () => void }) {
  const serving = run.provider === "ready";
  const tone = serving ? "var(--viz-good)" : run.running ? "var(--viz-warn)" : "var(--muted)";
  const headline = serving ? "Answering jobs" : run.running ? "Starting up…" : "Not answering jobs";
  const detail = serving
    ? run.reachableAt ?? "connected to the bridge"
    : run.running
      ? `runner ${run.runner} · provider ${run.provider}`
      : run.error ?? "The GPU runner and provider aren't running, so agents that find you will get nothing.";

  return (
    <div
      className="card"
      style={{
        padding: "16px 20px",
        display: "flex",
        alignItems: "center",
        gap: 16,
        flexWrap: "wrap",
        borderColor: serving ? "color-mix(in srgb, var(--viz-good) 26%, transparent)" : "var(--line)",
      }}
    >
      <span aria-hidden style={{ color: tone, display: "flex", flexShrink: 0 }}>
        <IconCpu size={16} />
      </span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 15, color: "var(--text)" }}>{headline}</div>
        <div
          className={run.reachableAt && serving ? "mono" : undefined}
          style={{ fontSize: 12.5, color: run.error && !run.running ? "var(--viz-crit)" : "var(--muted)", marginTop: 3, wordBreak: "break-all" }}
        >
          {detail}
        </div>
      </div>
      <button className="chip" onClick={run.running ? onStop : onStart} disabled={busy} style={{ flexShrink: 0 }}>
        {busy ? "…" : run.running ? "Stop node" : "Start node"}
      </button>
    </div>
  );
}

function Offline({ onGoLive }: { onGoLive: () => void }) {
  return (
    <div
      className="card"
      style={{
        padding: "22px 24px",
        display: "flex",
        alignItems: "center",
        gap: 22,
        flexWrap: "wrap",
        borderColor: "color-mix(in srgb, var(--accent) 34%, transparent)",
        background:
          "linear-gradient(100deg, color-mix(in srgb, var(--accent) 9%, var(--surface-2)), var(--surface-2) 62%)",
      }}
    >
      <div
        aria-hidden
        style={{
          display: "grid",
          placeItems: "center",
          width: 42,
          height: 42,
          borderRadius: 12,
          flexShrink: 0,
          color: "var(--accent)",
          border: "1px solid color-mix(in srgb, var(--accent) 32%, transparent)",
          background: "var(--accent-softer)",
        }}
      >
        <IconBroadcast size={19} />
      </div>

      <div style={{ minWidth: 0, flex: "1 1 320px" }}>
        <h2 className="font-serif" style={{ margin: 0, fontSize: 24, letterSpacing: "-0.01em", lineHeight: 1.2 }}>
          This node isn&apos;t earning yet
        </h2>
        <p style={{ margin: "7px 0 0", color: "var(--muted)", fontSize: 13.5, lineHeight: 1.7, maxWidth: "62ch" }}>
          Agents can&apos;t discover you until this Mac is listed on the market. Publish a listing —
          your name, your price, signed by your own wallet — and it starts showing up.
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-start", flexShrink: 0 }}>
        <Button onClick={onGoLive} style={{ display: "inline-flex", alignItems: "center", gap: 9 }}>
          <IconBolt size={15} />
          Go live
        </Button>
        <span style={{ fontSize: 11.5, color: "var(--muted)" }}>takes one signature</span>
      </div>
    </div>
  );
}
