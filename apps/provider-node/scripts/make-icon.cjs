/**
 * Renders the app icon from the brand wordmark's own font and writes build/icon.icns (+ a PNG for
 * the dev dock). Run it with Electron, which already has everything needed to rasterise type:
 *
 *   ../../node_modules/.bin/electron scripts/make-icon.cjs
 *
 * Committed so the icon can be regenerated when the mark changes, rather than being an opaque
 * binary nobody can edit. Output is deterministic; re-running it should produce the same bytes.
 */
const { app, BrowserWindow } = require("electron");
const { execFileSync } = require("node:child_process");
const { mkdirSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");

const OUT = join(__dirname, "..", "build");
const FONT = join(__dirname, "..", "src", "renderer", "theme", "fonts", "instrument-serif-normal.woff2");

// macOS icon grid: a 1024 icon with the artwork inset to 824, corner radius ~22.4% of that.
// Laid out at half that, because a 1024pt window doesn't fit on a laptop display and gets clamped
// (silently cropping the canvas). Every dimension is a fraction of CANVAS, and the capture is
// normalised to ICON below, so the result is identical whatever the display's scale factor.
const ICON = 1024;
const CANVAS = 512;
const PLATE = CANVAS * 0.8047;
const INSET = (CANVAS - PLATE) / 2;
const px = (fraction) => `${(CANVAS * fraction).toFixed(2)}px`;

function page() {
  const font = readFileSync(FONT).toString("base64");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @font-face { font-family: "Instrument Serif"; src: url(data:font/woff2;base64,${font}) format("woff2"); font-weight: 400; }
    html, body { margin: 0; width: ${CANVAS}px; height: ${CANVAS}px; background: transparent; overflow: hidden; }
    .plate {
      position: absolute; left: ${INSET}px; top: ${INSET}px; width: ${PLATE}px; height: ${PLATE}px;
      border-radius: ${(PLATE * 0.2237).toFixed(2)}px;
      background:
        radial-gradient(120% 95% at 20% 4%, #22301a 0%, transparent 58%),
        linear-gradient(155deg, #121810 0%, #070907 64%);
      box-shadow: inset 0 0 0 ${px(0.002)} rgba(226, 236, 222, 0.08);
      display: grid; place-items: center;
    }
    .mark { display: flex; align-items: baseline; gap: ${px(0.039)}; transform: translateY(4%); }
    .letter { font-family: "Instrument Serif", serif; font-size: ${px(0.586)}; line-height: 1; color: #eaf0e5; }
    .dot { width: ${px(0.086)}; height: ${px(0.086)}; border-radius: 999px; background: #c2f24a; }
  </style></head><body>
    <div class="plate"><div class="mark"><span class="letter">d</span><span class="dot"></span></div></div>
  </body></html>`;
}

function iconset(sourcePng) {
  const dir = join(OUT, "icon.iconset");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  // The exact set `iconutil` expects; anything missing and it refuses the whole bundle.
  for (const [size, name] of [
    [16, "icon_16x16.png"], [32, "icon_16x16@2x.png"],
    [32, "icon_32x32.png"], [64, "icon_32x32@2x.png"],
    [128, "icon_128x128.png"], [256, "icon_128x128@2x.png"],
    [256, "icon_256x256.png"], [512, "icon_256x256@2x.png"],
    [512, "icon_512x512.png"], [1024, "icon_512x512@2x.png"],
  ]) {
    const target = join(dir, name);
    writeFileSync(target, sourcePng);
    execFileSync("/usr/bin/sips", ["-z", String(size), String(size), target], { stdio: "ignore" });
  }
  execFileSync("/usr/bin/iconutil", ["-c", "icns", dir, "-o", join(OUT, "icon.icns")]);
  rmSync(dir, { recursive: true, force: true });
}

app.whenReady().then(async () => {
  mkdirSync(OUT, { recursive: true });
  const win = new BrowserWindow({
    width: CANVAS,
    height: CANVAS,
    show: true,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    webPreferences: { backgroundThrottling: false },
  });
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(page())}`);
  // Two frames plus a beat: the webfont has to be decoded and laid out before the capture.
  await win.webContents.executeJavaScript(
    "document.fonts.ready.then(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 400)))))",
  );
  await win.webContents.capturePage();
  const master = join(OUT, "icon.png");
  writeFileSync(master, (await win.webContents.capturePage()).toPNG());
  // capturePage hands back device pixels, so pin the master to the icon size before slicing it up.
  execFileSync("/usr/bin/sips", ["-z", String(ICON), String(ICON), master], { stdio: "ignore" });
  iconset(readFileSync(master));
  console.log(`wrote ${join(OUT, "icon.icns")} and icon.png`);
  app.quit();
});
