export type PillTone = "accent" | "muted" | "error";

const DOT_COLOR: Record<PillTone, string> = { accent: "var(--accent)", muted: "var(--muted)", error: "#ff6b6b" };

export function PillBadge({ label, tone = "muted", pulse = false }: { label: string; tone?: PillTone; pulse?: boolean }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 14px",
        borderRadius: 999,
        border: "1px solid var(--line)",
        fontSize: 11,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        color: "var(--muted-bright)",
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: 999,
          background: DOT_COLOR[tone],
          animation: pulse ? "decomp-breathe 2.2s ease-in-out infinite" : undefined,
        }}
      />
      {label}
    </span>
  );
}
