import type { CSSProperties, ReactNode } from "react";

export function Card({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div
      style={{
        borderRadius: 18,
        border: "1px solid var(--line)",
        background: "color-mix(in srgb, var(--text) 3%, transparent)",
        backdropFilter: "blur(12px)",
        padding: 22,
        ...style,
      }}
    >
      {children}
    </div>
  );
}
