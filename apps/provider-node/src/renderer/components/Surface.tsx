import type { CSSProperties, ReactNode } from "react";

/** Section heading used above a group of cards — the one place a screen names what follows. */
export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, minHeight: 22 }}>
      <h2 style={{ margin: 0, fontSize: 12, letterSpacing: "0.09em", textTransform: "uppercase", color: "var(--muted)", fontWeight: 400 }}>
        {children}
      </h2>
      {action}
    </div>
  );
}

export function Card({
  children,
  title,
  subtitle,
  action,
  padding = 20,
  interactive = false,
  style,
}: {
  children?: ReactNode;
  title?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  padding?: number | string;
  interactive?: boolean;
  style?: CSSProperties;
}) {
  return (
    <div className={`card${interactive ? " card-hover" : ""}`} style={{ padding, ...style }}>
      {(title || action) && (
        <header style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: children ? 16 : 0 }}>
          <div style={{ minWidth: 0 }}>
            {title && <div style={{ fontSize: 12, letterSpacing: "0.09em", textTransform: "uppercase", color: "var(--muted)" }}>{title}</div>}
            {subtitle && <div style={{ color: "var(--muted-bright)", fontSize: 13, marginTop: 6, lineHeight: 1.5 }}>{subtitle}</div>}
          </div>
          {action}
        </header>
      )}
      {children}
    </div>
  );
}

export function Label({ children }: { children: ReactNode }) {
  return <span style={{ fontSize: 12, letterSpacing: "0.09em", textTransform: "uppercase", color: "var(--muted)" }}>{children}</span>;
}

/** A label/value pair, the unit every detail panel in the app is built from. */
export function DetailRow({ label, children, align = "right" }: { label: ReactNode; children: ReactNode; align?: "right" | "left" }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        gap: 16,
        padding: "9px 0",
        minWidth: 0,
      }}
    >
      <span style={{ color: "var(--muted)", fontSize: 13, flexShrink: 0 }}>{label}</span>
      <span style={{ color: "var(--text)", fontSize: 13.5, textAlign: align, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
        {children}
      </span>
    </div>
  );
}

export function Divider() {
  return <div style={{ height: 1, background: "var(--line)", margin: "4px 0" }} />;
}
