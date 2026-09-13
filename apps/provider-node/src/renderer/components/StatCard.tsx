import type { ReactNode } from "react";

export function StatCard({ label, value, unit, footer }: { label: string; value: ReactNode; unit?: string; footer?: ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        padding: 22,
        borderRadius: 18,
        border: "1px solid var(--line)",
        background: "color-mix(in srgb, var(--text) 3%, transparent)",
        backdropFilter: "blur(12px)",
      }}
    >
      <span style={{ color: "var(--muted)", fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase" }}>{label}</span>
      <span className="font-serif" style={{ fontSize: 40, lineHeight: 1, color: "var(--text)" }}>
        {value}
        {unit && (
          <span style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 14, color: "var(--muted-bright)", marginLeft: 8 }}>{unit}</span>
        )}
      </span>
      {footer && <div style={{ color: "var(--muted-bright)", fontSize: 12 }}>{footer}</div>}
    </div>
  );
}
