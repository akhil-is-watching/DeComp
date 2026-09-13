import type { ReactNode } from "react";

export type Tone = "neutral" | "accent" | "good" | "warn" | "crit";

/** Status colour is never the only signal — every tone ships with its own label text. */
const TONE: Record<Tone, { fg: string; dot: string; border: string; bg: string }> = {
  neutral: { fg: "var(--muted-bright)", dot: "var(--muted)", border: "var(--line)", bg: "transparent" },
  accent: { fg: "var(--accent)", dot: "var(--accent)", border: "color-mix(in srgb, var(--accent) 34%, transparent)", bg: "var(--accent-softer)" },
  good: { fg: "var(--viz-good)", dot: "var(--viz-good)", border: "color-mix(in srgb, var(--viz-good) 32%, transparent)", bg: "color-mix(in srgb, var(--viz-good) 9%, transparent)" },
  warn: { fg: "var(--viz-warn)", dot: "var(--viz-warn)", border: "color-mix(in srgb, var(--viz-warn) 32%, transparent)", bg: "color-mix(in srgb, var(--viz-warn) 9%, transparent)" },
  crit: { fg: "var(--viz-crit)", dot: "var(--viz-crit)", border: "color-mix(in srgb, var(--viz-crit) 32%, transparent)", bg: "color-mix(in srgb, var(--viz-crit) 9%, transparent)" },
};

export function Badge({
  children,
  tone = "neutral",
  dot = false,
  pulse = false,
  uppercase = true,
}: {
  children: ReactNode;
  tone?: Tone;
  dot?: boolean;
  pulse?: boolean;
  uppercase?: boolean;
}) {
  const t = TONE[tone];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        padding: dot ? "4px 11px 4px 9px" : "4px 10px",
        borderRadius: 999,
        border: `1px solid ${t.border}`,
        background: t.bg,
        color: t.fg,
        fontSize: 11.5,
        letterSpacing: uppercase ? "0.12em" : "0.02em",
        textTransform: uppercase ? "uppercase" : "none",
        whiteSpace: "nowrap",
        lineHeight: 1.5,
      }}
    >
      {dot && (
        <span
          style={{
            width: 5,
            height: 5,
            borderRadius: 999,
            background: t.dot,
            flexShrink: 0,
            animation: pulse ? "decomp-breathe 2.4s ease-in-out infinite" : undefined,
          }}
        />
      )}
      {children}
    </span>
  );
}
