import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { discoverLiveProviders } from "@decomp/agent";
import { formatTinybars } from "@decomp/hedera-x402";
import { env } from "../../env";

export const listProvidersTool = {
  name: "list_providers",
  description:
    "List GPU providers currently online and able to take a job, with their price per second. A provider whose " +
    "registration is on-chain but whose GPU runner isn't answering right now is left out. Optionally filter by job type.",
  inputSchema: {
    type: "object" as const,
    properties: { jobType: { type: "string", enum: ["benchmark", "mandelbrot", "imagegen"], description: "Only show providers offering this job type." } },
  },
};

export async function listProviders(args: { jobType?: string }): Promise<CallToolResult> {
  if (!env.registryTopicId) {
    return { content: [{ type: "text", text: "No REGISTRY_TOPIC_ID is configured; there's no registry to query." }], isError: true };
  }
  const jobTypes = args.jobType ? [args.jobType] : ["benchmark", "mandelbrot", "imagegen"];
  const lines: string[] = [];
  for (const jobType of jobTypes) {
    // A registration on HCS outlives the process that published it, so a raw registry read would
    // list nodes whose runner went offline hours ago. Only candidates whose /health answers right
    // now (see @decomp/agent's discovery.ts) are worth sending a job to.
    const candidates = await discoverLiveProviders(env.registryTopicId, jobType);
    if (candidates.length === 0) {
      lines.push(`${jobType}: no providers currently online for this`);
      continue;
    }
    lines.push(`${jobType}:`);
    for (const c of candidates.sort((a, b) => Number(a.pricePerSecTinybars - b.pricePerSecTinybars))) {
      lines.push(`  ${c.providerId} (${c.hederaAccount}) — ${formatTinybars(c.pricePerSecTinybars)}/s, ${c.tickSeconds}s ticks — ${c.endpoint}`);
    }
  }
  return { content: [{ type: "text", text: lines.join("\n") }] };
}
