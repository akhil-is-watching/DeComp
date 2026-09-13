/** The landing page's faint animated dot-grid texture, decorative only. */
export function DotGridBackground() {
  return (
    <div
      aria-hidden
      style={{
        position: "fixed",
        inset: "-20% -10%",
        pointerEvents: "none",
        zIndex: 0,
        opacity: 0.4,
        backgroundImage: "radial-gradient(circle at center, var(--accent) 1px, transparent 1.4px)",
        backgroundSize: "34px 34px",
        animation: "decomp-drift 34s linear infinite",
      }}
    />
  );
}
