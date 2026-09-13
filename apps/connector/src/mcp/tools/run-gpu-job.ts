/**
 * The main tool: pay for a GPU job with the caller's own Privy wallet and return the result. A
 * mandelbrot render comes back as an inline MCP image block, so Claude can show it in the chat.
 */
import type { CallToolResult, ImageContent, TextContent } from "@modelcontextprotocol/sdk/types.js";
import { discoverAndRunJob, runJob, type JobSummary } from "@decomp/agent";
import { formatTinybars, hashscanTxUrl, hbarToTinybars } from "@decomp/hedera-x402";
import type { HederaIdentity } from "@decomp/privy-hedera";
import { env } from "../../env";
import { validateJobParams } from "../validate-params";

export const runGpuJobTool = {
  name: "run_gpu_job",
  description:
    "Pay for and run a GPU job on the DeComp network, using your own wallet. Blocks until the job " +
    `finishes or a budget is reached (at most ${env.maxBudgetHbar} ℏ, regardless of what is asked for). ` +
    "Job types: 'benchmark' (a dense matmul benchmark), 'mandelbrot' (renders a PNG, returned inline), and " +
    "'imagegen' (renders a seeded plasma-art PNG asset, returned inline).",
  inputSchema: {
    type: "object" as const,
    properties: {
      jobType: { type: "string", enum: ["benchmark", "mandelbrot", "imagegen"] },
      params: {
        type: "object",
        description:
          "benchmark: backend ('mlx'|'torch'), size (512|1024|2048|4096), duration_s (0.5-600), seed. " +
          "mandelbrot: width/height (64-4096), max_iter (16-20000), center_x, center_y, span (0-8]. " +
          "imagegen: width/height (64-4096), seed.",
      },
      maxBudgetHbar: { type: "number", description: `Stop paying beyond this many HBAR (capped at ${env.maxBudgetHbar}).` },
      provider: { type: "string", description: "Optional: a specific provider URL instead of routing via the registry." },
    },
    required: ["jobType"],
  },
};

function summaryText(summary: JobSummary): string {
  const lines = [
    `Provider: ${summary.providerId} (${summary.providerAccount})`,
    `Status: ${summary.status} (${summary.state})`,
    `Paid: ${formatTinybars(summary.totalAmount)} across ${summary.payments.length} tick(s) of ${summary.tickSeconds}s`,
    ...(summary.budgetExhausted ? ["Stopped: reached the budget ceiling before the job finished"] : []),
    ...summary.payments.map(p => hashscanTxUrl(p.transactionId)),
  ];
  if (summary.error) lines.push(`Error: ${summary.error}`);
  return lines.join("\n");
}

export async function runGpuJob(
  identity: HederaIdentity,
  args: { jobType?: string; params?: Record<string, unknown>; maxBudgetHbar?: number; provider?: string },
): Promise<CallToolResult> {
  if (!args.jobType) return { content: [{ type: "text", text: "jobType is required" }], isError: true };
  const validated = validateJobParams(args.jobType, args.params ?? {});
  if (!validated.ok) return { content: [{ type: "text", text: validated.error }], isError: true };

  const budgetHbar = Math.min(args.maxBudgetHbar ?? env.maxBudgetHbar, env.maxBudgetHbar);
  const maxBudget = hbarToTinybars(budgetHbar);
  const log = (line: string) => console.log(`[connector] ${identity.role} ${line}`);

  let summary: JobSummary;
  try {
    if (args.provider) {
      summary = await runJob({
        providerUrl: args.provider,
        jobType: args.jobType,
        params: validated.params,
        identity,
        maxAmountPerPayment: maxBudget,
        maxBudget,
        auditTopicId: env.auditTopicId,
        confirmOnMirror: true,
        log,
      });
    } else if (env.registryTopicId) {
      ({ summary } = await discoverAndRunJob({
        topicId: env.registryTopicId,
        jobType: args.jobType,
        params: validated.params,
        identity,
        maxBudget,
        auditTopicId: env.auditTopicId,
        confirmOnMirror: true,
        log,
      }));
    } else {
      return { content: [{ type: "text", text: "No provider was given and no REGISTRY_TOPIC_ID is configured to route through." }], isError: true };
    }
  } catch (error) {
    return { content: [{ type: "text", text: `job did not complete: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
  }

  const content: (TextContent | ImageContent)[] = [{ type: "text", text: summaryText(summary) }];
  const png = (summary.result as { png_base64?: string } | undefined)?.png_base64;
  if (png) content.push({ type: "image", data: png, mimeType: "image/png" });

  return { content, isError: summary.status !== "succeeded" };
}
