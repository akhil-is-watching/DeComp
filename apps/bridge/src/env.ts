/** Bridge configuration. No Privy, no signing — it only verifies, never signs anything itself. */
export const env = {
  port: Number(process.env.PORT ?? process.env.BRIDGE_PORT ?? 4040),
  baseUrl: (process.env.BRIDGE_BASE_URL ?? `http://127.0.0.1:${process.env.PORT ?? process.env.BRIDGE_PORT ?? 4040}`).replace(/\/$/, ""),
};
