import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: resolve(__dirname, "src/main/index.ts") } },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
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
