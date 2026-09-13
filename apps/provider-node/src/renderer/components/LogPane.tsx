import { useEffect, useRef } from "react";

export function LogPane({ lines }: { lines: string[] }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  return (
    <div
      ref={ref}
      style={{
        borderRadius: 14,
        border: "1px solid var(--line)",
        background: "color-mix(in srgb, var(--ink) 70%, transparent)",
        padding: "14px 16px",
        height: 220,
        overflowY: "auto",
        fontSize: 12,
        lineHeight: 1.6,
        color: "var(--muted-bright)",
        whiteSpace: "pre-wrap",
        wordBreak: "break-all",
      }}
    >
      {lines.length === 0 ? <span style={{ color: "var(--muted)" }}>no output yet…</span> : lines.map((line, i) => <div key={i}>{line}</div>)}
    </div>
  );
}
