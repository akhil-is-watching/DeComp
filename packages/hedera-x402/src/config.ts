export type HederaNetwork = "hedera:testnet" | "hedera:mainnet";

/** x402 asset id for native HBAR; amounts are in tinybars. */
export const HBAR_ASSET = "0.0.0";
export const TINYBARS_PER_HBAR = 100_000_000n;

const NETWORKS: Record<HederaNetwork, { mirrorNodeUrl: string; hashscan: string; facilitatorUrl: string }> = {
  "hedera:testnet": {
    mirrorNodeUrl: "https://testnet.mirrornode.hedera.com",
    hashscan: "https://hashscan.io/testnet",
    facilitatorUrl: "https://api.testnet.blocky402.com",
  },
  "hedera:mainnet": {
    mirrorNodeUrl: "https://mainnet.mirrornode.hedera.com",
    hashscan: "https://hashscan.io/mainnet",
    facilitatorUrl: "https://api.blocky402.com/v1",
  },
};

export function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required env var ${name} (see .env.example)`);
  }
  return value;
}

export function hederaNetwork(): HederaNetwork {
  const network = process.env.HEDERA_NETWORK ?? "hedera:testnet";
  if (network !== "hedera:testnet" && network !== "hedera:mainnet") {
    throw new Error(`Unsupported HEDERA_NETWORK ${network}`);
  }
  return network;
}

export function networkConfig(network: HederaNetwork = hederaNetwork()) {
  return {
    network,
    ...NETWORKS[network],
    mirrorNodeUrl: process.env.MIRROR_NODE_URL ?? NETWORKS[network].mirrorNodeUrl,
    facilitatorUrl: process.env.FACILITATOR_URL ?? NETWORKS[network].facilitatorUrl,
  };
}

export function hashscanTxUrl(transactionId: string, network: HederaNetwork = hederaNetwork()): string {
  return `${NETWORKS[network].hashscan}/transaction/${transactionId}`;
}

export function hbarToTinybars(hbar: number): bigint {
  return BigInt(Math.round(hbar * Number(TINYBARS_PER_HBAR)));
}

export function formatTinybars(tinybars: bigint | string): string {
  const value = BigInt(tinybars);
  const whole = value / TINYBARS_PER_HBAR;
  const frac = (value % TINYBARS_PER_HBAR).toString().padStart(8, "0").replace(/0+$/, "");
  return `${whole}${frac ? `.${frac}` : ""} ℏ`;
}
