import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { formatTinybars, getHbarBalance, getTokenBalance, networkConfig } from "@decomp/hedera-x402";
import type { HederaIdentity } from "@decomp/privy-hedera";
import { env } from "../../env";

export const getWalletBalanceTool = {
  name: "get_wallet_balance",
  description: "Your DeComp wallet's Hedera account id, HBAR balance, and compute-token (DCC) balance.",
  inputSchema: { type: "object" as const, properties: {} },
};

export async function getWalletBalance(identity: HederaIdentity): Promise<CallToolResult> {
  const { hashscan } = networkConfig();
  const hbar = await getHbarBalance(identity.accountId);
  const dcc = env.computeTokenId ? await getTokenBalance(identity.accountId, env.computeTokenId) : null;
  const lines = [
    `Account: ${identity.accountId}`,
    `HBAR: ${formatTinybars(hbar)}`,
    dcc === null ? "Compute token (DCC): not associated" : `Compute token (DCC): ${dcc} units`,
    `${hashscan}/account/${identity.accountId}`,
  ];
  return { content: [{ type: "text", text: lines.join("\n") }] };
}
