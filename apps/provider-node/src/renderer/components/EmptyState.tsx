import type { ReactNode } from "react";

/** Every empty list says what would fill it and what to do next — never just "no data". */
export function EmptyState({ icon, title, body, action }: { icon?: ReactNode; title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        textAlign: "center",
        gap: 10,
        padding: "44px 24px",
        color: "var(--muted)",
      }}
    >
      {icon && (
        <div
          style={{
            display: "grid",
            placeItems: "center",
            width: 40,
            height: 40,
            borderRadius: 12,
            border: "1px solid var(--line)",
            background: "var(--surface-sunken)",
            color: "var(--muted-bright)",
            marginBottom: 2,
          }}
        >
          {icon}
        </div>
      )}
      <div style={{ color: "var(--text)", fontSize: 14 }}>{title}</div>
      {body && <div style={{ maxWidth: "46ch", lineHeight: 1.65, fontSize: 13 }}>{body}</div>}
      {action && <div style={{ marginTop: 6 }}>{action}</div>}
    </div>
  );
}
