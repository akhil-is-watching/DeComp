import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import type { HederaIdentity } from "@decomp/privy-hedera";
import { getJobHistory, getJobHistoryTool } from "./tools/get-job-history";
import { getWalletBalance, getWalletBalanceTool } from "./tools/get-wallet-balance";
import { listProviders, listProvidersTool } from "./tools/list-providers";
import { runGpuJob, runGpuJobTool } from "./tools/run-gpu-job";

export const TOOLS: Tool[] = [runGpuJobTool, listProvidersTool, getWalletBalanceTool, getJobHistoryTool];

export async function callTool(name: string, args: Record<string, unknown>, identity: HederaIdentity): Promise<CallToolResult> {
  switch (name) {
    case "run_gpu_job":
      return runGpuJob(identity, args);
    case "list_providers":
      return listProviders(args);
    case "get_wallet_balance":
      return getWalletBalance(identity);
    case "get_job_history":
      return getJobHistory(identity, args);
    default:
      return { content: [{ type: "text", text: `unknown tool ${name}` }], isError: true };
  }
}
