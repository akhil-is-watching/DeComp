import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";

// This monorepo has no build step for its workspace packages — @decomp/* resolve straight to raw
// .ts source (see each package.json's "exports"), meant to be run by a TS-native runtime (Bun)
// rather than required as compiled CJS. electron-vite's default externalizeDepsPlugin treats every
// node_modules dependency as already-compiled and leaves it as a plain `require(...)`, which then
// fails at runtime in Electron's Node main process ("Unexpected token 'export'") because it's
// handed a .ts file Node has no loader for. Exclude our own packages so Rollup actually bundles
// and transpiles them instead; genuine third-party deps (electron, @hiero-ledger/sdk, ws, ...)
// stay externalized as normal.
const WORKSPACE_PACKAGES = ["@decomp/bridge-protocol", "@decomp/hcs-registry", "@decomp/hedera-x402", "@decomp/privy-hedera"];

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: WORKSPACE_PACKAGES })],
    build: { rollupOptions: { input: resolve(__dirname, "src/main/index.ts") } },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: WORKSPACE_PACKAGES })],
    build: { rollupOptions: { input: resolve(__dirname, "src/main/preload.ts") } },
  },
  renderer: {
    root: resolve(__dirname, "src/renderer"),
    // The embedded-wallet signing math (ported from @decomp/privy-hedera) uses Buffer, which
    // doesn't exist in a browser/renderer context on its own. `process` is a defensive addition:
    // some @decomp/* helpers (e.g. hashscanTxUrl's default network param) read process.env when
    // not given an explicit value — polyfilled so that degrades to undefined instead of throwing.
    plugins: [react(), nodePolyfills({ include: ["buffer", "process"] })],
    build: {
      rollupOptions: { input: resolve(__dirname, "src/renderer/index.html") },
    },
  },
});
