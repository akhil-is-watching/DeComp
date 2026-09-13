/** The landing page's blurred gradient blobs, decorative only, mounted once behind the router. */
export function GlowBackground() {
  return (
    <div aria-hidden style={{ position: "fixed", inset: 0, pointerEvents: "none", overflow: "hidden", zIndex: 0 }}>
      <div
        style={{
          position: "absolute",
          top: "-30vh",
          left: "-18vw",
          width: "70vw",
          height: "70vw",
          borderRadius: "50%",
          background: "radial-gradient(circle, var(--glow-blue), transparent 62%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          bottom: "-34vh",
          right: "-20vw",
          width: "66vw",
          height: "66vw",
          borderRadius: "50%",
          background: "radial-gradient(circle, var(--glow-accent), transparent 62%)",
        }}
      />
    </div>
  );
}
