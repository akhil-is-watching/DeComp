import { TopicMessageSubmitTransaction, type Client } from "@hiero-ledger/sdk";
import type { ProviderRegistration } from "./registry";

export type PublishResult = { transactionId: string; sequenceNumber: number };

/**
 * Submits a JSON message paid for by the client's operator. Readers attribute the message to
 * that payer, so publish with the account the message is about.
 */
export async function publishJson(
  client: Client,
  topicId: string,
  payload: unknown,
  { maxChunks }: { maxChunks?: number } = {},
): Promise<PublishResult> {
  const tx = new TopicMessageSubmitTransaction().setTopicId(topicId).setMessage(JSON.stringify(payload));
  if (maxChunks !== undefined) tx.setMaxChunks(maxChunks);
  const response = await tx.execute(client);
  const receipt = await response.getReceipt(client);
  return { transactionId: response.transactionId.toString(), sequenceNumber: receipt.topicSequenceNumber?.toNumber() ?? 0 };
}

export function publishRegistration(client: Client, topicId: string, registration: ProviderRegistration): Promise<PublishResult> {
  // Readers ignore multi-chunk messages, so a registration must fit in one.
  return publishJson(client, topicId, registration, { maxChunks: 1 });
}
