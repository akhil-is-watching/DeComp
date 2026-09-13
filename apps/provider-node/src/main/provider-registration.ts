/**
 * Publishes this node's listing to the HCS registry topic, signed by the user's own embedded
 * wallet.
 *
 * This has to happen here rather than in apps/provider because of how the registry authenticates:
 * readers only count a registration when the account that *paid* for the HCS message is the
 * account the message advertises (see currentRegistrations in @decomp/hcs-registry). The desktop
 * node's account is keyed by the user's embedded wallet, and the only thing that can sign for it
 * is the live renderer session — apps/provider signs as a Privy *server* wallet from .env, so it
 * structurally cannot list this account.
 *
 * No Electron import: driven by a plain RawSigner, same as account-provisioning.ts, so the
 * publishing logic is unit-testable without a real window.
 */
import { publishRegistration, REGISTRATION_SCHEMA, type JobTypeOffer } from "@decomp/hcs-registry";
import { hederaNetwork, type HederaNetwork } from "@decomp/hedera-x402";
import { createEmbeddedWalletIdentity, type RawSigner } from "./identity/embedded-wallet-identity";

export type RegistrationRequest = {
  registryTopicId: string;
  accountId: string;
  address: string;
  providerId: string;
  endpoint: string;
  jobTypes: JobTypeOffer[];
  network?: HederaNetwork;
};

export type RegistrationResult = { sequenceNumber: number; transactionId: string; publishedAt: string };

/** Mirrors parseRegistration's rules, so a rejected message fails here with a readable reason
 *  instead of being silently dropped by every reader on the topic. */
function validate(request: RegistrationRequest): void {
  if (!/^\d+\.\d+\.\d+$/.test(request.accountId)) throw new Error(`"${request.accountId}" is not a Hedera account id`);
  if (!/^\d+\.\d+\.\d+$/.test(request.registryTopicId)) throw new Error("no registry topic is configured");
  if (request.providerId.length === 0 || request.providerId.length > 64) throw new Error("a node name must be 1–64 characters");
  try {
    if (!["http:", "https:"].includes(new URL(request.endpoint).protocol)) throw new Error();
  } catch {
    throw new Error(`"${request.endpoint}" is not an http(s) endpoint`);
  }
  if (request.jobTypes.length === 0) throw new Error("pick at least one job type to offer");
  for (const offer of request.jobTypes) {
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(offer.name)) throw new Error(`"${offer.name}" is not a valid job type`);
    if (!/^\d+$/.test(offer.pricePerSecTinybars) || BigInt(offer.pricePerSecTinybars) <= 0n) {
      throw new Error(`${offer.name} needs a price above zero`);
    }
    if (!Number.isInteger(offer.tickSeconds) || offer.tickSeconds < 1 || offer.tickSeconds > 3600) {
      throw new Error(`${offer.name} needs a tick of 1–3600 seconds`);
    }
  }
}

export async function registerProviderForSigner(sign: RawSigner, request: RegistrationRequest): Promise<RegistrationResult> {
  validate(request);
  const network = request.network ?? hederaNetwork();

  const identity = await createEmbeddedWalletIdentity(sign, request.accountId, request.address, network);
  const client = identity.createClient();
  try {
    const publishedAt = new Date().toISOString();
    const { sequenceNumber, transactionId } = await publishRegistration(client, request.registryTopicId, {
      schema: REGISTRATION_SCHEMA,
      providerId: request.providerId,
      hederaAccount: request.accountId,
      endpoint: request.endpoint,
      network,
      jobTypes: request.jobTypes,
      publishedAt,
    });
    return { sequenceNumber, transactionId, publishedAt };
  } finally {
    client.close();
  }
}
