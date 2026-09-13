import { useEffect, useRef, useState, type ReactNode } from "react";

/** Anchored menu that closes on outside click or Escape, the way every Mac menu does. */
export function Popover({ trigger, children, width = 240 }: { trigger: (open: boolean) => ReactNode; children: (close: () => void) => ReactNode; width?: number }) {
  const [open, setOpen] = useState(false);
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!host.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={host} className="no-drag" style={{ position: "relative" }}>
      <div onClick={() => setOpen(o => !o)}>{trigger(open)}</div>
      {open && (
        <div
          role="menu"
          className="rise"
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            right: 0,
            width,
            background: "var(--surface-1)",
            border: "1px solid var(--line-strong)",
            borderRadius: "var(--r-md)",
            boxShadow: "var(--shadow-pop)",
            padding: 6,
            zIndex: 20,
          }}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function MenuItem({ children, onClick, tone }: { children: ReactNode; onClick: () => void; tone?: "crit" }) {
  return (
    <button
      role="menuitem"
      className="row-button"
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 9,
        padding: "8px 10px",
        fontSize: 13,
        color: tone === "crit" ? "var(--viz-crit)" : "var(--muted-bright)",
        borderRadius: 8,
      }}
    >
      {children}
    </button>
  );
}
