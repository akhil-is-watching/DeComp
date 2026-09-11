/** Publishes each finished job's payment record to the HCS audit topic, signed and paid for by the agent. */
import { AUDIT_SCHEMA, publishAudit, type JobAudit, type PublishResult } from "@decomp/hcs-registry";
import { sdkClient, type AccountCredentials } from "@decomp/hedera-x402";
import type { JobSummary } from "./run-job";

export function buildAudit(summary: JobSummary, agentAccount: string): JobAudit {
  return {
    schema: AUDIT_SCHEMA,
    jobId: summary.jobId,
    jobType: summary.jobType,
    network: summary.network,
    provider: { id: summary.providerId, account: summary.providerAccount, endpoint: summary.providerUrl },
    agent: agentAccount,
    asset: summary.asset,
    tickSeconds: summary.tickSeconds,
    transactions: summary.payments.map(p => p.transactionId),
    totalPaid: summary.totalAmount,
    wallClockS: summary.wallClockS ?? 0,
    status: summary.status,
    completedAt: new Date().toISOString(),
  };
}

export async function publishJobAudit(topicId: string, account: AccountCredentials, summary: JobSummary): Promise<PublishResult> {
  const client = sdkClient(account);
  try {
    return await publishAudit(client, topicId, buildAudit(summary, account.accountId));
  } finally {
    client.close();
  }
}
