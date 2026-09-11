# Build Plan — Decentralized GPU Compute Network on Hedera x402

Each phase has a **goal**, the **modules** it builds, and **validation constraints** — hard
gates you must pass before starting the next phase. If a gate fails, you fix it in that
phase; you don't carry the risk forward. Phases are ordered so that after Phase 2 you
already have a submittable project — everything after that is bonus points, not
qualification risk.

---

## Phase 0 — Environment & Accounts
**Time-box: a few hours, same day as kickoff**

### Modules
- Hedera testnet accounts: 1 agent (payer), 2–3 provider (receiver) — ECDSA, via portal.hedera.com
- HBAR funding via the Hedera faucet
- HTS token association script (`scripts/setup-hedera-accounts.ts`) for later USDC/custom-token use
- Local ML stack check: MLX and/or PyTorch with MPS backend

### Validation constraints (must all pass before Phase 1)
- [ ] `curl https://api.testnet.blocky402.com/supported` returns a `hedera:testnet` kind with a `feePayer` account
- [ ] Every Hedera testnet account shows a non-zero HBAR balance via the mirror node REST API (`https://testnet.mirrornode.hedera.com/api/v1/accounts/{id}`)
- [ ] `python -c "import mlx.core as mx; print(mx.default_device())"` prints a GPU device
- [ ] `python -c "import torch; print(torch.backends.mps.is_available())"` prints `True`
- [ ] `bun --version` and workspace install (`bun install`) complete with no errors on a clean clone

**Do not proceed if any of these fail** — everything downstream depends on a working facilitator connection and a working local compute backend.

---

## Phase 1 — Payment Spine (single provider, single job type)
**Time-box: Day 1**

Goal: one real, honest, paid GPU job, end to end. Use the **benchmark** job type here
(matmul / small training loop) — no model weights to download, fastest path to a working
loop. Image-gen and upscale get added in later phases.

### Modules
- `packages/hedera-x402` — Blocky402 client wiring, `ExactHederaScheme` signer wrapper
- `apps/provider` (single instance) — `/jobs` route with a flat-price 402 gate (no ticking yet)
- `services/job-runner` — FastAPI sidecar, benchmark job only, real wall-clock timing
- `apps/agent` — minimal script: request → pay → poll → result (CLI is fine, no UI yet)

### Validation constraints
- [ ] `POST /jobs` with no payment returns HTTP 402 with a `paymentRequirements` object whose `extra.feePayer` matches what `/supported` advertised in Phase 0
- [ ] Agent builds and signs a `TransferTransaction`; `/verify` returns `isValid: true`
- [ ] `/settle` returns `success: true` with a transaction ID that resolves on HashScan testnet (open the link, confirm it's a real transfer)
- [ ] The job actually executes on the GPU (MPS/MLX) and returns a result — not a stub
- [ ] Full cycle (quote → pay → verify → run → result) completes with **zero manual steps**
- [ ] Run the full cycle 3 times back-to-back with no failures (catches nonce/signature reuse bugs early — these are the hardest to debug later)

**This phase alone, if nothing else gets built, already satisfies the bounty's core qualification requirements.** Don't let scope creep from Phase 3+ delay reaching this checkpoint.

---

## Phase 2 — Multi-Provider Discovery & Routing
**Time-box: Day 1 evening / Day 2 morning**

### Modules
- `packages/hcs-registry` — publish + mirror-node query helpers
- HCS registry topic created once via `scripts/create-hcs-topics.ts`
- 2 more `apps/provider` instances, different job types and prices, each publishing `{jobTypes, pricePerSec, hederaAccount}` on boot
- `apps/agent`: `discovery.ts` (read registry) + `router.ts` (cheapest-eligible-provider selection)

### Validation constraints
- [ ] All 3 provider processes publish a registry message on boot; a mirror-node query for the topic returns all 3 messages within ~10s of startup (consensus + mirror ingestion latency)
- [ ] Agent's discovery correctly filters out providers that don't offer the requested job type
- [ ] Router selection is unit-tested against a mocked registry with known prices — confirm it always picks the cheapest eligible option, not just the first
- [ ] Kill one provider process, then have the agent attempt to route to it: agent catches the failure (timeout/connection error) and falls back to the next-cheapest provider without crashing

**Checkpoint: this is your safe "always submittable" state.** Commit and tag here before starting Phase 3.

---

## Phase 3 — Metering & Streamed Ticks
**Time-box: Day 2**

Add a job type that legitimately runs long enough to meter — image generation (MLX SDXL-Turbo/SD) or upscaling (PyTorch MPS Real-ESRGAN). This is also the most visually convincing demo material, so it's worth the time even though it's bonus-only.

### Modules
- `apps/provider/src/job-queue.ts` — tick scheduler, wall-clock timeout enforcement
- `apps/provider/src/x402-gate.ts` — extended to issue a new 402 "continue" challenge every N seconds of runtime
- `services/job-runner/metering.py` — real wall-clock GPU-seconds per job, not the client's estimate
- `apps/agent` — tick-payment loop with a budget ceiling

### Validation constraints
- [ ] At least one job type genuinely runs >10s of GPU time under MLX/MPS (confirm by timing it directly, not by trusting the tick count)
- [ ] A single job run produces **multiple distinct on-chain transaction IDs** — confirm at least 3 separate settlements on HashScan/mirror node for one job
- [ ] Billed ticks match actual measured compute time within ±1 tick (compare `job_runner`'s logged wall-clock against the provider's billed tick count)
- [ ] Budget-ceiling test: set the agent's max budget below the job's likely total cost; confirm the agent stops paying ticks and the provider independently kills the job on a missed tick (don't rely on the agent's honesty alone — the provider must enforce its own timeout)

---

## Phase 4 — Audit Trail & HTS Settlement
**Time-box: Day 2 evening / Day 3 morning**

### Modules
- `apps/agent/src/audit.ts` — publish a summary message to an HCS audit topic after every completed job
- `scripts/mint-compute-token.ts` — mint a custom HTS fungible token
- `apps/provider/src/pricing.ts` — accept the HTS token as an alternate `asset` alongside HBAR

### Validation constraints
- [ ] Every completed job produces an audit message on the HCS audit topic containing: provider ID, job ID, all tick transaction IDs, total amount paid, total wall-clock time
- [ ] Audit entries are independently reconstructable: write a small standalone script (not reusing agent code) that reads the audit topic + tick tx IDs from the mirror node and recomputes total spend per provider — it must match the agent's own numbers
- [ ] At least one full job is paid entirely in the custom HTS token, start to finish (`asset` = token ID, not `0.0.0`), with `/verify` and `/settle` both succeeding
- [ ] Both provider and agent testnet accounts show the HTS token association completed before this test runs (association failures look like generic settlement failures — verify separately first)

---

## Phase 5 — Identity, Polish, Demo Prep
**Time-box: Day 3 / Day 4 morning, leave real buffer here**

### Modules
- (Optional, time-permitting) HCS-14-formatted identity fields in registry messages
- `README.md` — setup, architecture, payment flow (this is a literal, named qualification requirement — don't leave it thin)
- `docs/ARCHITECTURE.md` — finalized diagram matching what was actually built, not what was planned
- `docs/DEMO_SCRIPT.md` — shot list for the video
- Error-state polish: what happens on screen when a payment fails, a provider is down, a job times out — judges will see the happy path in the video, but a live Q&A may poke at edge cases

### Validation constraints
- [ ] Fresh clone, on a different machine if possible: `bun install` → documented `.env` setup → `bun run setup:hedera && bun run setup:topics` → `bun run dev:*` reproduces the full flow with **zero undocumented manual steps**
- [ ] Re-read the bounty's qualification requirements as a literal checklist against your repo/video — a live x402-gated service on testnet/mainnet via Blocky402 ✓, a consuming agent that completes a real paid request ✓, public repo with setup/architecture/payment-flow README ✓, demo video ≤5 min showing the paid request executing ✓
- [ ] Demo video shows, in order: the 402 response, a real signature being produced, the on-chain settlement (open on HashScan live), the GPU job actually running (visible output, e.g. an image appearing), the result returned to the agent, and — if time allows — the HCS audit trail pulled up as independent proof
- [ ] Submit with time to spare for a re-upload if the video has an issue — don't render/export for the first time at the deadline

---

## Risk notes

- **Phases 1–2 are the floor.** If you're behind schedule, protect these two above everything else — they alone satisfy every literal qualification requirement in the bounty.
- **Phase 3 (ticking) is the highest-effort bonus item.** It's worth building because it directly answers the "micropayment streaming" example in the bounty text, but if Day 2 runs long, a flat per-job price with honest wall-clock-based pricing (no ticking) still satisfies "pay-per-call ... rather than a flat per-request charge" reasonably well — don't let ticking block Phase 4/5.
- **Don't build Docker sandboxing for the job runner** — Docker Desktop on macOS can't reach the Metal GPU. Sandbox via subprocess timeouts, resource limits, and a fixed job menu instead (already reflected in the module list above).