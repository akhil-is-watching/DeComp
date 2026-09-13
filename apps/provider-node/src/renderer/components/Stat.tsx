import type { ReactNode } from "react";
import { Sparkline } from "./Sparkline";
import { Skeleton } from "./Skeleton";

export type Delta = { value: number; label: string } | null;

/**
 * The stat-tile contract: label · value · optional unit · optional delta against a named period ·
 * optional trend. Values keep proportional figures — tabular digits make a display number look
 * loose; that's for columns.
 */
export function Stat({
  label,
  value,
  unit,
  icon,
  delta,
  trend,
  footer,
  loading = false,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  icon?: ReactNode;
  delta?: Delta;
  trend?: number[];
  footer?: ReactNode;
  loading?: boolean;
}) {
  return (
    <div className="card" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--muted)" }}>
        {icon}
        <span style={{ fontSize: 11.5, letterSpacing: "0.09em", textTransform: "uppercase" }}>{label}</span>
      </div>

      {loading ? (
        <Skeleton width="70%" height={30} />
      ) : (
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12, minWidth: 0 }}>
          <span className="font-serif" style={{ fontSize: 34, lineHeight: 1.05, letterSpacing: "-0.01em", minWidth: 0, wordBreak: "break-word" }}>
            {value}
            {unit && <span style={{ fontFamily: "inherit", fontSize: 16, color: "var(--muted-bright)", marginLeft: 6 }}>{unit}</span>}
          </span>
          {trend && trend.length > 1 && <Sparkline values={trend} />}
        </div>
      )}

      {(delta || footer) && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", minHeight: 16 }}>
          {delta && <DeltaPill delta={delta} />}
          {/* Its own line when it shares the row with a delta, so an account id is never cut short. */}
          {footer && <span style={{ color: "var(--muted)", fontSize: 12.5, flex: delta ? "1 1 100%" : "1 1 auto", minWidth: 0 }}>{footer}</span>}
        </div>
      )}
    </div>
  );
}

/** More earned is always good here, so direction and sentiment point the same way. */
function DeltaPill({ delta }: { delta: NonNullable<Delta> }) {
  const flat = Math.abs(delta.value) < 0.05;
  const color = flat ? "var(--muted)" : delta.value > 0 ? "var(--viz-good)" : "var(--viz-crit)";
  const sign = flat ? "" : delta.value > 0 ? "+" : "−";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, color }}>
      <span aria-hidden style={{ fontSize: 11 }}>
        {flat ? "→" : delta.value > 0 ? "▲" : "▼"}
      </span>
      <span className="tabular">
        {sign}
        {Math.abs(delta.value).toFixed(Math.abs(delta.value) >= 100 ? 0 : 1)}%
      </span>
      <span style={{ color: "var(--muted)" }}>{delta.label}</span>
    </span>
  );
}
