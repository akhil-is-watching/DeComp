# Demo script

A shot list for a video under 5 minutes. It covers, in order: the 402 response, a real
signature, the on-chain settlement opened live on HashScan, the GPU job running with visible
output, the result returned to the agent, and the HCS audit trail as independent proof.

## Before recording

- [ ] `bun run check:phase0` passes, and the agent account holds at least 5 ℏ.
- [ ] `REGISTRY_TOPIC_ID`, `AUDIT_TOPIC_ID`, and `COMPUTE_TOKEN_ID` are set in `.env`
      (`bun run setup:topics`, `bun run setup:token`).
- [ ] Terminal with a large font, split in two: **left** for `bun run dev`, **right** for agent
      commands.
- [ ] Browser tabs open on HashScan testnet: the agent account, the PROVIDER_3 account, and the
      audit topic (`https://hashscan.io/testnet/topic/<AUDIT_TOPIC_ID>`).
- [ ] Warm up MLX once, since the first run compiles GPU kernels and is slower:
      `bun run agent -- --job mandelbrot --params '{"width":256,"max_iter":64}' --skip-mirror`
- [ ] Do one full rehearsal, and render and upload the video well before the deadline.

## Shot list

| Time | Shot | Do | Show and say |
|---|---|---|---|
| 0:00–0:25 | What it is | Show the first diagram in `docs/ARCHITECTURE.md`. | "Agents rent Apple-silicon GPUs and pay per five seconds of compute with x402, settled on Hedera through Blocky402." |
| 0:25–0:50 | Providers come online | Left pane: `bun run dev` | Each provider prints `registered on HCS topic … (seq N)`; the runner lists `benchmark, mandelbrot`. |
| 0:50–1:20 | The 402 | Right pane: `curl -si -X POST localhost:4023/jobs -H 'content-type: application/json' -d '{"jobType":"mandelbrot"}'` | `HTTP/1.1 402`, the `PAYMENT-REQUIRED` header, and the JSON `accepts`: one tick in HBAR and in DCC, `payTo`, and `extra.feePayer` `0.0.7162784`. |
| 1:20–2:30 | A paid GPU job | Right pane: `bun run agent -- --job mandelbrot --params '{"width":2048,"height":2048,"max_iter":2000}' --save out/demo.png` | `route` picks the cheapest provider (PROVIDER_3), then `402`, `signed TransferTransaction <id>`, `settled <HashScan link>`, and a new `tick` line every five seconds. The left pane shows each tick settling. |
| 2:30–3:10 | On-chain settlement | Open the first `settled` link. | A transfer from the agent to PROVIDER_3 with status SUCCESS and the fee paid by `0.0.7162784`. Then the PROVIDER_3 account page, with one transfer per tick. |
| 3:10–3:40 | The result | `open out/demo.png`, then scroll back to the agent's `result` and `mirror` lines. | The rendered image; "succeeded after ~12 s, 3 ticks paid", with every tick confirmed on the mirror node. |
| 3:40–4:20 | Audit trail | `bun run audit:reconstruct`, then refresh the audit topic tab. | This job's record, rebuilt from the chain alone: claimed total equals on-chain total ✓, published by the agent. |
| 4:20–5:00 | Provider enforcement (if time) | `bun run agent -- --job mandelbrot --params '{"width":2048,"height":2048,"max_iter":4000}' --budget-hbar 0.3` | The agent stops paying after two ticks; the provider logs `killing it` about 15 s in, and the agent reports the job `killed`. |

## If asked about failure cases

| Question | Show |
|---|---|
| What if a provider is down? | Stop `bun run dev` and restart it as `bun run dev -- --skip PROVIDER_2`; PROVIDER_2's registration is still on HCS. Then `bun run agent -- --job benchmark`: the agent logs `fallback PROVIDER_2 unavailable … trying next` and pays PROVIDER_1, the next-cheapest. It never falls back after signing. |
| What if the payment is bad? | A payment signed with the wrong key gets a 402 and no job starts (`bun test apps/provider/test/gate.test.ts`). Blocky402's testnet `/verify` accepted such payments, so the provider checks signatures itself. |
| What if the agent stops paying? | The last shot: the provider kills the job on its own once paid time plus grace runs out. |
| What if a job runs too long? | The runner enforces `max_runtime_s` and reports the job as `timeout`. |
| Can I trust the audit log? | `bun run audit:reconstruct` recomputes every total from mirror-node data without using agent code, and flags records the agent didn't publish. |
