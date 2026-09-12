import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { readAudits } from "@decomp/hcs-registry";
import { formatTinybars, hederaNetwork, HBAR_ASSET } from "@decomp/hedera-x402";
import type { HederaIdentity } from "@decomp/privy-hedera";
import { env } from "../../env";

export const getJobHistoryTool = {
  name: "get_job_history",
  description: "Your past GPU jobs paid through DeComp, most recent first, from the on-chain audit trail.",
  inputSchema: {
    type: "object" as const,
    properties: { limit: { type: "number", description: "Maximum jobs to return (default 10)." } },
  },
};

export async function getJobHistory(identity: HederaIdentity, args: { limit?: number }): Promise<CallToolResult> {
  if (!env.auditTopicId) {
    return { content: [{ type: "text", text: "No AUDIT_TOPIC_ID is configured; there's no audit trail to read." }], isError: true };
  }
  const limit = Math.max(1, Math.min(args.limit ?? 10, 50));
  const entries = (await readAudits(env.auditTopicId, { network: hederaNetwork() }))
    .filter(a => a.payerAccountId === identity.accountId)
    .sort((a, b) => (a.consensusTimestamp < b.consensusTimestamp ? 1 : -1))
    .slice(0, limit);

  if (entries.length === 0) {
    return { content: [{ type: "text", text: "No jobs found for your account yet." }] };
  }
  const lines = entries.map(a => {
    const amount = a.asset === HBAR_ASSET ? formatTinybars(a.totalPaid) : `${a.totalPaid} units of ${a.asset}`;
    return `${a.jobId} — ${a.provider.id} — ${amount} — ${a.wallClockS}s — ${a.transactions.length} tick(s) — ${a.consensusTimestamp}`;
  });
  return { content: [{ type: "text", text: lines.join("\n") }] };
}
