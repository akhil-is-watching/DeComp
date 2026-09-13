import { type ButtonHTMLAttributes, useState } from "react";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" };

export function Button({ variant = "primary", style, ...rest }: Props) {
  const [hover, setHover] = useState(false);
  const primary = variant === "primary";
  return (
    <button
      {...rest}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        borderRadius: 999,
        border: primary ? "none" : "1px solid var(--line)",
        background: primary ? (hover ? "var(--accent-hover)" : "var(--accent)") : "transparent",
        color: primary ? "var(--ink)" : "var(--text)",
        padding: "12px 22px",
        fontFamily: "inherit",
        fontSize: 13,
        fontWeight: 500,
        letterSpacing: "0.04em",
        cursor: rest.disabled ? "default" : "pointer",
        opacity: rest.disabled ? 0.5 : 1,
        transition: "transform 150ms ease-out, box-shadow 150ms ease-out, background 150ms ease-out",
        transform: primary && hover ? "translateY(-2px)" : undefined,
        boxShadow: primary && hover ? "0 10px 30px rgba(194, 242, 74, 0.28)" : undefined,
        ...style,
      }}
    />
  );
}
