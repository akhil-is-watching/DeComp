/**
 * What's on screen before the dashboard is. The account-setup path used to enumerate its steps,
 * but on every launch after the first it's gone in about a second — a checklist that flashes past
 * is noise, not information. So both waits are the same thing now: the mark, breathing, with one
 * line of context only when the wait is the genuinely slow one (first-login provisioning).
 */
import type { ReactNode } from "react";
import { IconAlert } from "../components/icons";
import { DragStrip } from "../components/DragStrip";

export function Splash({ caption }: { caption?: string }) {
  return (
    <Centered>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 22 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <span className="font-serif" style={{ fontSize: 38, letterSpacing: "-0.02em", animation: "decomp-fade 2.6s ease-in-out infinite" }}>
            decomp
          </span>
          <span
            aria-hidden
            style={{ width: 7, height: 7, borderRadius: 999, background: "var(--accent)", animation: "decomp-breathe 2.6s ease-in-out infinite" }}
          />
        </div>

        {/* Indeterminate, because neither wait can honestly report progress. */}
        <div role="progressbar" aria-label="Loading" style={{ position: "relative", width: 132, height: 2, borderRadius: 999, background: "var(--viz-track)", overflow: "hidden" }}>
          <div
            style={{
              position: "absolute",
              inset: 0,
              width: "40%",
              borderRadius: 999,
              background: "var(--accent)",
              animation: "decomp-sweep 1.5s var(--ease) infinite",
            }}
          />
        </div>

        {caption && (
          <p style={{ margin: 0, maxWidth: "42ch", textAlign: "center", color: "var(--muted)", fontSize: 13, lineHeight: 1.7 }}>{caption}</p>
        )}
      </div>
    </Centered>
  );
}

export function SetupFailed({ error, onRetry }: { error?: string; onRetry: () => void }) {
  return (
    <Centered>
      <div className="rise" style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 460 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <IconAlert size={16} style={{ color: "var(--viz-crit)" }} />
          <span className="font-serif" style={{ fontSize: 22 }}>
            Account setup didn't finish
          </span>
        </div>
        {error && <p style={{ margin: 0, color: "var(--muted)", fontSize: 13, lineHeight: 1.75 }}>{error}</p>}
        <div>
          <button className="chip" onClick={onRetry}>
            Try again
          </button>
        </div>
      </div>
    </Centered>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <div style={{ position: "relative", zIndex: 1, minHeight: "100vh", display: "grid", placeItems: "center", padding: 32 }}>
      <DragStrip />
      <div className="no-drag">{children}</div>
    </div>
  );
}
