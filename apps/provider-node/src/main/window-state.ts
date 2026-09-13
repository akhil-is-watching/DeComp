/** Remembers the window's size and position between launches, the way a Mac app is expected to. */
import { screen, type BrowserWindow, type Rectangle } from "electron";
import { loadSettings, saveSettings } from "./settings-store";

const DEFAULT_BOUNDS = { width: 1180, height: 800 };

/** Saved bounds, dropped if the display they were on is gone (external monitor unplugged). */
export function restoredBounds(): Partial<Rectangle> {
  const saved = loadSettings().windowBounds;
  if (!saved) return DEFAULT_BOUNDS;
  const visible = screen.getAllDisplays().some(display => {
    const a = display.workArea;
    return saved.x < a.x + a.width && saved.x + saved.width > a.x && saved.y < a.y + a.height && saved.y + saved.height > a.y;
  });
  return visible ? saved : DEFAULT_BOUNDS;
}

/** Persists bounds on resize/move, coalesced so a drag doesn't write the file on every frame. */
export function trackBounds(win: BrowserWindow): void {
  let timer: NodeJS.Timeout | undefined;
  const persist = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!win.isDestroyed() && !win.isMinimized() && !win.isFullScreen()) saveSettings({ windowBounds: win.getBounds() });
    }, 400);
  };
  win.on("resize", persist);
  win.on("move", persist);
  win.on("close", () => clearTimeout(timer));
}
