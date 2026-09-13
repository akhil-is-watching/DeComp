/**
 * Window backdrops. Both are static.
 *
 * The dashboard previously sat on the landing page's drifting dot grid over two glow blobs: it
 * crawled behind tables and charts, and pulled the eye off the numbers. Decoration that moves
 * belongs on a screen with nothing to read, so the dot grid is now confined to the signed-out and
 * setup screens, and the dashboard gets one flat wash that never moves.
 */

/** Behind the signed-in app: a single fixed wash, no texture, no motion. */
export function DashboardBackdrop() {
  return (
    <div
      aria-hidden
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 0,
        pointerEvents: "none",
        background: "radial-gradient(120% 70% at 50% -20%, var(--glow-accent), transparent 70%)",
      }}
    />
  );
}

/** Behind the login and setup screens, where there's room for the brand to breathe. */
export function WelcomeBackdrop() {
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
      <div
        style={{
          position: "absolute",
          inset: 0,
          opacity: 0.07,
          backgroundImage: "radial-gradient(circle at center, var(--accent) 1px, transparent 1.4px)",
          backgroundSize: "34px 34px",
        }}
      />
    </div>
  );
}
