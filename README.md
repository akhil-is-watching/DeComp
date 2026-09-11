# DeComp

A decentralized GPU compute network where agents pay providers per job over
[x402](https://x402.org), settled on Hedera through the
[Blocky402](https://blocky402.com) facilitator. Providers run jobs on Apple
Silicon GPUs (MLX / PyTorch MPS).

> Work in progress. The build is staged by the phases and validation gates in
> [docs/BUILD_PLAN.md](docs/BUILD_PLAN.md); full architecture and payment-flow
> docs land in Phase 5.

## Requirements

- Apple Silicon Mac (the job runner refuses to run on CPU)
- [Bun](https://bun.com) 1.2+
- [uv](https://docs.astral.sh/uv/) (installs Python 3.12 for the job runner)
- One ECDSA Hedera testnet account from [portal.hedera.com](https://portal.hedera.com)

## Setup

```bash
bun install
bun run setup:runner          # Python 3.12 venv with MLX, PyTorch, FastAPI
cp .env.example .env          # then set OPERATOR_ID and OPERATOR_KEY
bun run setup:hedera          # creates + funds agent and provider accounts
bun run check:phase0          # facilitator, balances, GPU backends, lockfile
```

`setup:hedera` only needs the operator account; it generates ECDSA keys for
the agent and three providers, funds them, associates testnet USDC, and writes
the credentials to `.env`. Re-running it is safe.

`.env` holds private keys and is gitignored — never commit it.

## Layout

| Path | What it is |
|---|---|
| `packages/hedera-x402` | Network config, key parsing, mirror node helpers, x402 wiring |
| `services/job-runner` | FastAPI sidecar that runs a fixed job menu as killable GPU subprocesses |
| `scripts/` | Account setup and phase validation gates |
| `docs/` | Build plan |
