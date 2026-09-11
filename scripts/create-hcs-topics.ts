/** Creates the HCS topics once and records their ids in .env. Safe to re-run. */
import { TopicCreateTransaction } from "@hiero-ledger/sdk";
import { mirrorGet, networkConfig, parsePrivateKey, requireEnv, sdkClient } from "@decomp/hedera-x402";
import { upsertEnv } from "./lib/env-file";

const topics = [{ envVar: "REGISTRY_TOPIC_ID", memo: "decomp provider registry v1" }];

const { hashscan } = networkConfig();
const operator = { accountId: requireEnv("OPERATOR_ID"), privateKey: parsePrivateKey(requireEnv("OPERATOR_KEY")) };
const client = sdkClient(operator);

try {
  for (const { envVar, memo } of topics) {
    const existing = process.env[envVar];
    if (existing) {
      const info = await mirrorGet<{ memo: string; deleted: boolean }>(`/api/v1/topics/${existing}`).catch(() => null);
      if (info && !info.deleted) {
        console.log(`${envVar}=${existing} already exists ("${info.memo}")`);
        continue;
      }
      console.log(`${envVar}=${existing} is not on the mirror node; creating a new topic`);
    }
    // No submit key: anyone may post, and readers only trust a registration paid for by the
    // account it advertises. The admin key lets the operator update or delete the topic.
    const response = await new TopicCreateTransaction()
      .setTopicMemo(memo)
      .setAdminKey(operator.privateKey.publicKey)
      .execute(client);
    const { topicId } = await response.getReceipt(client);
    await upsertEnv({ [envVar]: topicId!.toString() });
    console.log(`created ${envVar}=${topicId} ${hashscan}/topic/${topicId}`);
  }
} finally {
  client.close();
}
