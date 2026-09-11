import { mirrorGet, type HederaNetwork } from "@decomp/hedera-x402";
import { parseRegistration, type RegistryEntry } from "./registry";

export type TopicMessage = {
  consensus_timestamp: string;
  message: string;
  payer_account_id: string;
  sequence_number: number;
  topic_id: string;
  chunk_info?: { number: number; total: number } | null;
};

export type TopicQuery = { network?: HederaNetwork; afterTimestamp?: string };

/** Every message on a topic in consensus order, following mirror-node pagination. */
export async function fetchTopicMessages(topicId: string, { network, afterTimestamp }: TopicQuery = {}): Promise<TopicMessage[]> {
  const messages: TopicMessage[] = [];
  let path: string | null =
    `/api/v1/topics/${topicId}/messages?order=asc&limit=100` + (afterTimestamp ? `&timestamp=gt:${afterTimestamp}` : "");
  while (path) {
    const page: { messages: TopicMessage[]; links: { next: string | null } } = await mirrorGet(path, network);
    messages.push(...page.messages);
    path = page.links.next;
  }
  return messages;
}

/** Decodes a single-chunk JSON message; anything else decodes to null. */
export function decodeJsonMessage(message: TopicMessage): unknown {
  if (message.chunk_info && message.chunk_info.total > 1) return null;
  try {
    return JSON.parse(Buffer.from(message.message, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

/** All well-formed registrations on the topic. Use `currentRegistrations` to authenticate and dedupe. */
export async function readRegistry(topicId: string, query: TopicQuery = {}): Promise<RegistryEntry[]> {
  const entries: RegistryEntry[] = [];
  for (const message of await fetchTopicMessages(topicId, query)) {
    const registration = parseRegistration(decodeJsonMessage(message));
    if (registration) {
      entries.push({
        ...registration,
        consensusTimestamp: message.consensus_timestamp,
        sequenceNumber: message.sequence_number,
        payerAccountId: message.payer_account_id,
      });
    }
  }
  return entries;
}
