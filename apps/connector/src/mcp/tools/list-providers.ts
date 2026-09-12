import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { discoverProviders } from "@decomp/agent";
import { formatTinybars } from "@decomp/hedera-x402";
import { env } from "../../env";

export const listProvidersTool = {
  name: "list_providers",
  description: "List GPU providers currently registered, with their price per second. Optionally filter by job type.",
  inputSchema: {
    type: "object" as const,
    properties: { jobType: { type: "string", enum: ["benchmark", "mandelbrot"], description: "Only show providers offering this job type." } },
  },
};

export async function listProviders(args: { jobType?: string }): Promise<CallToolResult> {
  if (!env.registryTopicId) {
    return { content: [{ type: "text", text: "No REGISTRY_TOPIC_ID is configured; there's no registry to query." }], isError: true };
  }
  const jobTypes = args.jobType ? [args.jobType] : ["benchmark", "mandelbrot"];
  const lines: string[] = [];
  for (const jobType of jobTypes) {
    const candidates = await discoverProviders(env.registryTopicId, jobType);
    if (candidates.length === 0) {
      lines.push(`${jobType}: no providers currently offer this`);
      continue;
    }
    lines.push(`${jobType}:`);
    for (const c of candidates.sort((a, b) => Number(a.pricePerSecTinybars - b.pricePerSecTinybars))) {
      lines.push(`  ${c.providerId} (${c.hederaAccount}) — ${formatTinybars(c.pricePerSecTinybars)}/s, ${c.tickSeconds}s ticks — ${c.endpoint}`);
    }
  }
  return { content: [{ type: "text", text: lines.join("\n") }] };
}
