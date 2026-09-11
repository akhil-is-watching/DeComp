/**
 * Job audit records on the HCS audit topic: one JSON message per finished job, published and paid
 * for by the agent, listing every settlement transaction so anyone can re-check the spend on the
 * mirror node.
 */
import type { Client } from "@hiero-ledger/sdk";
import { publishJson, type PublishResult } from "./publish";
import { readJsonMessages, type TopicQuery } from "./topic";

export const AUDIT_SCHEMA = "decomp/job-audit@1";

export type JobAudit = {
  schema: typeof AUDIT_SCHEMA;
  jobId: string;
  jobType: string;
  network: string;
  provider: { id: string; account: string; endpoint: string };
  /** Account that paid for the job; readers should check it also published the record. */
  agent: string;
  /** "0.0.0" for HBAR or the HTS token id the job was paid in. */
  asset: string;
  tickSeconds: number;
  /** Settlement transaction id of every tick, in payment order. */
  transactions: string[];
  /** Sum of all ticks in the asset's smallest unit. */
  totalPaid: string;
  wallClockS: number;
  status: string;
  completedAt: string;
};

export type AuditEntry = JobAudit & { consensusTimestamp: string; sequenceNumber: number; payerAccountId: string };

const ENTITY_ID = /^\d+\.\d+\.\d+$/;
const TRANSACTION_ID = /^\d+\.\d+\.\d+@\d+\.\d+$/;

export function parseAudit(value: unknown): JobAudit | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const provider = v.provider as Record<string, unknown> | null | undefined;
  if (v.schema !== AUDIT_SCHEMA) return null;
  if (typeof v.jobId !== "string" || typeof v.jobType !== "string" || typeof v.network !== "string") return null;
  if (!provider || typeof provider.id !== "string" || typeof provider.endpoint !== "string") return null;
  if (typeof provider.account !== "string" || !ENTITY_ID.test(provider.account)) return null;
  if (typeof v.agent !== "string" || !ENTITY_ID.test(v.agent)) return null;
  if (typeof v.asset !== "string" || !ENTITY_ID.test(v.asset)) return null;
  if (typeof v.tickSeconds !== "number" || typeof v.wallClockS !== "number") return null;
  if (typeof v.status !== "string" || typeof v.completedAt !== "string") return null;
  if (typeof v.totalPaid !== "string" || !/^\d+$/.test(v.totalPaid)) return null;
  if (!Array.isArray(v.transactions) || !v.transactions.every(t => typeof t === "string" && TRANSACTION_ID.test(t))) return null;
  return {
    schema: AUDIT_SCHEMA,
    jobId: v.jobId,
    jobType: v.jobType,
    network: v.network,
    provider: { id: provider.id, account: provider.account, endpoint: provider.endpoint },
    agent: v.agent,
    asset: v.asset,
    tickSeconds: v.tickSeconds,
    transactions: v.transactions as string[],
    totalPaid: v.totalPaid,
    wallClockS: v.wallClockS,
    status: v.status,
    completedAt: v.completedAt,
  };
}

export function publishAudit(client: Client, topicId: string, audit: JobAudit): Promise<PublishResult> {
  // Long jobs list many ticks and may exceed one 1KB chunk; readers reassemble chunks.
  return publishJson(client, topicId, audit);
}

export async function readAudits(topicId: string, query: TopicQuery = {}): Promise<AuditEntry[]> {
  const entries: AuditEntry[] = [];
  for (const message of await readJsonMessages(topicId, query)) {
    const audit = parseAudit(message.payload);
    if (audit) {
      entries.push({
        ...audit,
        consensusTimestamp: message.consensusTimestamp,
        sequenceNumber: message.sequenceNumber,
        payerAccountId: message.payerAccountId,
      });
    }
  }
  return entries;
}
