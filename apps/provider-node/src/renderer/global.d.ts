import type { DecompApi } from "../main/preload";

declare global {
  interface Window {
    decomp: DecompApi;
  }
}
