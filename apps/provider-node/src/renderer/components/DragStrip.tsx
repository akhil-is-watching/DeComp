/**
 * The window-drag handle for screens that have no toolbar (login, splash).
 *
 * These used to make their whole full-viewport container `-webkit-app-region: drag`, which is a
 * trap: Electron turns that into an OS-level draggable mask over the window, and only elements
 * that explicitly say `no-drag` are cut back out of it. `app-region: none` — the default, and what
 * the Privy dialog's portal computes to — does not. So anything rendered on top of a full-screen
 * drag region, including a modal in a portal, silently stops receiving mouse events entirely.
 *
 * A strip the height of the title bar is all that's needed: it sits behind the content, lines up
 * with the traffic lights, and leaves the rest of the window interactive.
 */
export function DragStrip() {
  return <div aria-hidden className="drag" style={{ position: "fixed", top: 0, left: 0, right: 0, height: "var(--titlebar-h)", zIndex: 0 }} />;
}
