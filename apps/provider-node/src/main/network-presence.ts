/**
 * Makes a running provider process actually reachable and discoverable: connects to the bridge
 * (if configured) and publishes the one-time-per-boot HCS registration — the two things the
 * embedded wallet identity signs for, per embedded-wallet-identity.ts's own header.
 */
import { REGISTRATION_SCHEMA, publishRegistration } from "@decomp/hcs-registry";
import type { HederaNetwork } from "@decomp/hedera-x402";
import { connectBridge, type BridgeConnection } from "./bridge-client";
import type { EmbeddedWalletIdentity } from "./identity/embedded-wallet-identity";

/** Parses "benchmark:2000000,mandelbrot:3000000" the way apps/provider/src/pricing.ts does, minimally. */
export function parseOffersForRegistration(spec: string, tickSeconds: number): { name: string; pricePerSecTinybars: string; tickSeconds: number }[] {
  return spec
    .split(",")
    .map(s => s.trim())
    .filter(Boolean)
    .map(entry => {
      const [jobType, price] = entry.split(":");
      if (!jobType || !price || !/^\d+$/.test(price)) throw new Error(`invalid offer "${entry}" — expected <jobType>:<tinybars per second>`);
      return { name: jobType, pricePerSecTinybars: price, tickSeconds };
    });
}

export type NetworkPresenceOptions = {
  identity: EmbeddedWalletIdentity;
  providerName: string;
  publicPort: number;
  bridgeUrl?: string;
  registryTopicId?: string;
  offersSpec: string;
  tickSeconds: number;
  network: HederaNetwork;
  log: (line: string) => void;
};

export type NetworkPresence = { stop: () => void };

export function startNetworkPresence(options: NetworkPresenceOptions): NetworkPresence {
  const endpoint = options.bridgeUrl ? `${options.bridgeUrl}/p/${options.identity.accountId}` : `http://127.0.0.1:${options.publicPort}`;

  let bridge: BridgeConnection | undefined;
  if (options.bridgeUrl) {
    bridge = connectBridge(options.bridgeUrl, options.identity, options.providerName, options.publicPort, options.log);
  }

  if (options.registryTopicId) {
    void publishRegistrationOnce(options, endpoint);
  }

  return {
    stop: () => bridge?.close(),
  };
}

async function publishRegistrationOnce(options: NetworkPresenceOptions, endpoint: string): Promise<void> {
  const client = options.identity.createClient();
  try {
    const jobTypes = parseOffersForRegistration(options.offersSpec, options.tickSeconds);
    const { sequenceNumber, transactionId } = await publishRegistration(client, options.registryTopicId!, {
      schema: REGISTRATION_SCHEMA,
      providerId: options.providerName,
      hederaAccount: options.identity.accountId,
      endpoint,
      network: options.network,
      jobTypes,
      publishedAt: new Date().toISOString(),
    });
    options.log(`registered on HCS topic ${options.registryTopicId} (seq ${sequenceNumber}, tx ${transactionId})`);
  } catch (error) {
    options.log(`registry publish failed: ${error instanceof Error ? error.message : error}`);
  } finally {
    client.close();
  }
}
