import { mirrorGet, type HederaNetwork } from "@decomp/hedera-x402";
import { parseRegistration, type RegistryEntry } from "./registry";

export type TopicMessage = {
  consensus_timestamp: string;
  message: string;
  payer_account_id: string;
  sequence_number: number;
  topic_id?: string;
  chunk_info?: {
    initial_transaction_id: { account_id: string; transaction_valid_start: string; nonce?: number };
    number: number;
    total: number;
  } | null;
};

export type TopicQuery = { network?: HederaNetwork; afterTimestamp?: string };

/** A decoded JSON message, attributed to the account that paid for it. */
export type JsonMessage = { payload: unknown; consensusTimestamp: string; sequenceNumber: number; payerAccountId: string };

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

/**
 * Decodes messages as JSON, joining the chunks HCS splits messages over 1KB into. A message
 * takes the timestamp and sequence number of its last chunk; incomplete or non-JSON messages are
 * skipped.
 */
export function decodeJsonMessages(messages: TopicMessage[]): JsonMessage[] {
  const decoded: JsonMessage[] = [];
  const pending = new Map<string, TopicMessage[]>();

  for (const message of messages) {
    let parts = [message];
    const info = message.chunk_info;
    if (info && info.total > 1) {
      const id = info.initial_transaction_id;
      const key = `${id.account_id}@${id.transaction_valid_start}#${id.nonce ?? 0}`;
      parts = [...(pending.get(key) ?? []), message];
      if (parts.length < info.total) {
        pending.set(key, parts);
        continue;
      }
      pending.delete(key);
      parts.sort((a, b) => (a.chunk_info?.number ?? 0) - (b.chunk_info?.number ?? 0));
    }

    const last = parts[parts.length - 1]!;
    try {
      const text = Buffer.concat(parts.map(p => Buffer.from(p.message, "base64"))).toString("utf8");
      decoded.push({
        payload: JSON.parse(text),
        consensusTimestamp: last.consensus_timestamp,
        sequenceNumber: last.sequence_number,
        payerAccountId: parts[0]!.payer_account_id,
      });
    } catch {
      // not JSON; ignore
    }
  }
  return decoded;
}

export async function readJsonMessages(topicId: string, query: TopicQuery = {}): Promise<JsonMessage[]> {
  return decodeJsonMessages(await fetchTopicMessages(topicId, query));
}

/** All well-formed registrations on the topic. Use `currentRegistrations` to authenticate and dedupe. */
export async function readRegistry(topicId: string, query: TopicQuery = {}): Promise<RegistryEntry[]> {
  const entries: RegistryEntry[] = [];
  for (const message of await readJsonMessages(topicId, query)) {
    const registration = parseRegistration(message.payload);
    if (registration) {
      entries.push({
        ...registration,
        consensusTimestamp: message.consensusTimestamp,
        sequenceNumber: message.sequenceNumber,
        payerAccountId: message.payerAccountId,
      });
    }
  }
  return entries;
}
