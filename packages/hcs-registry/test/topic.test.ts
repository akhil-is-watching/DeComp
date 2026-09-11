import { expect, test } from "bun:test";
import { decodeJsonMessages, type TopicMessage } from "../src/topic";

const b64 = (text: string) => Buffer.from(text).toString("base64");

function message(sequence: number, text: string, chunk?: { number: number; total: number; start?: string }): TopicMessage {
  return {
    consensus_timestamp: `1789150000.${String(sequence).padStart(9, "0")}`,
    message: b64(text),
    payer_account_id: "0.0.77",
    sequence_number: sequence,
    chunk_info: chunk
      ? {
          initial_transaction_id: { account_id: "0.0.77", transaction_valid_start: chunk.start ?? "1789149999.000000001", nonce: 0 },
          number: chunk.number,
          total: chunk.total,
        }
      : null,
  };
}

test("decodes single-chunk JSON messages with their consensus metadata", () => {
  expect(decodeJsonMessages([message(1, '{"a":1}')])).toEqual([
    { payload: { a: 1 }, consensusTimestamp: "1789150000.000000001", sequenceNumber: 1, payerAccountId: "0.0.77" },
  ]);
});

test("joins chunks in chunk order even when they arrive out of order", () => {
  const json = JSON.stringify({ transactions: Array.from({ length: 40 }, (_, i) => `0.0.7162784@1789150000.${i}`) });
  const [first, second] = [json.slice(0, 700), json.slice(700)];
  const decoded = decodeJsonMessages([message(8, second, { number: 2, total: 2 }), message(7, first, { number: 1, total: 2 })]);
  expect(decoded).toHaveLength(1);
  expect(decoded[0]!.payload).toEqual(JSON.parse(json));
  // The message is complete at its last chunk.
  expect(decoded[0]!.sequenceNumber).toBe(8);
});

test("keeps chunks of different messages apart", () => {
  const decoded = decodeJsonMessages([
    message(1, '{"x":', { number: 1, total: 2, start: "1.1" }),
    message(2, '{"y":', { number: 1, total: 2, start: "2.2" }),
    message(3, "1}", { number: 2, total: 2, start: "1.1" }),
    message(4, "2}", { number: 2, total: 2, start: "2.2" }),
  ]);
  expect(decoded.map(d => d.payload)).toEqual([{ x: 1 }, { y: 2 }]);
});

test("skips incomplete chunked messages and non-JSON messages", () => {
  expect(decodeJsonMessages([message(1, '{"partial":', { number: 1, total: 2 }), message(2, "hello world")])).toEqual([]);
});
