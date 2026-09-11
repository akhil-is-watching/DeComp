---
name: git-commits
description: Write Conventional Commit messages and manage staging, branches, and tags for the distributed ML inference marketplace monorepo (Hedera, x402, HCS, ONNX providers). Use this skill whenever the user asks to commit, stage, push, write a commit message, squash, amend, tag a release, name a branch, or clean up history — and also proactively whenever a coding task in this repo reaches a natural stopping point and changes are ready to be recorded. Use it even when the user just says "commit this" or "save my work" without mentioning conventions.
---

# Git commits for the DCM monorepo

Produce commits that are atomic, conventionally formatted, and safe to push to a public repo. This project's history is a judging artifact — a reviewer will read the log to understand how the system was built.

## Before every commit: three checks

Run these before staging. Two of them are specific to this project and a generic commit workflow will miss them.

### 1. No secrets

This repo touches Hedera operator keys constantly. `.env.testnet` holds private keys for buyer, provider, and treasury accounts.

```bash
git diff --cached --name-only | grep -E '\.env|\.pem$|\.key$'
git diff --cached -U0 | grep -iE '302e0201|PRIVATE KEY|operatorKey|0x[0-9a-f]{64}'
```

Account IDs (`0.0.123456`), token IDs, and topic IDs are public identifiers and are fine to commit — put them in `.env.example`. DER-encoded private keys (they start `302e0201`) and hex private keys are not. If one is already staged, unstage it and add the path to `.gitignore` before doing anything else.

### 2. No canary expected outputs

Canary verification only works because providers cannot identify canary items or look up their correct answers. Committing expected outputs to a public repo hands every provider a cheat sheet and silently destroys the security property the whole project rests on.

Safe to commit: the curation script, the selection criteria, the `canarySetHash`, and the count.
Never commit: expected labels, boxes, embeddings, or the item IDs used as canaries.

Keep `canaries/expected/` in `.gitignore` and say so in the README, since a reviewer will wonder.

### 3. No model weights

`.onnx` and `.mlpackage` files are fetched at runtime by content hash. Committing a 300MB model bloats the repo permanently. Commit the catalog entry — name, URL, SHA-256 — not the artifact.

## Format

```
<type>(<scope>): <subject>

<body>

<footer>
```

Subject line under 72 characters, imperative mood, lowercase, no trailing period. Write "add lease reclaim" not "Added lease reclaim." or "adds lease reclaim".

Body is optional for trivial changes and expected for anything non-obvious. Wrap at 72. The body explains **why**, since the diff already shows what.

## Types

| Type | Use for | Version effect |
|---|---|---|
| `feat` | New capability a user or another package can invoke | minor |
| `fix` | Corrects broken behaviour | patch |
| `perf` | Faster or lighter with no behaviour change | patch |
| `refactor` | Restructuring with no behaviour change | none |
| `docs` | Documentation, README, architecture notes | none |
| `test` | Tests only | none |
| `build` | Deps, tsconfig, pnpm workspace, Python requirements | none |
| `ci` | Workflow files | none |
| `chore` | Housekeeping that fits nothing above | none |
| `revert` | Undoes a previous commit | — |

Choosing between `fix` and `refactor` is the common ambiguity. If the behaviour before the change was wrong, it's `fix`. If it was right but ugly, it's `refactor`. If you're rewriting something that was wrong *and* ugly, split it into two commits.

`perf` needs a number in the body. "faster" without a measurement is not a claim, it's a hope.

## Scopes

Use the package or directory the change lives in:

| Scope | Path |
|---|---|
| `protocol` | `packages/protocol` — shared schemas |
| `hedera` | `packages/hedera` — token, topics, mirror node |
| `provider` | `packages/provider-agent` |
| `buyer` | `packages/buyer-agent` |
| `verifier` | `packages/verifier` |
| `engine` | `engine/` — Python inference |
| `canaries` | `canaries/` |
| `scripts` | `scripts/` |
| `docs` | `docs/`, README |

For changes spanning packages, use the scope where the *intent* lives and mention the rest in the body. A change that adds a manifest field and updates three consumers is `feat(protocol)`, with the consumers listed in the body.

Omit the scope only for genuinely repo-wide changes: `chore: bump pnpm to 9.12`.

## Breaking changes

Anything in `packages/protocol` is consumed by every other package and by the on-chain receipt format. Changing a schema breaks running providers and invalidates receipts already on HCS.

Mark it with `!` after the scope and a `BREAKING CHANGE:` footer explaining the migration:

```
feat(protocol)!: add preprocess hash to ChunkManifest

Providers must assert the preprocessing spec before inference, since
interpolation and normalization differences between nodes produce
divergent outputs and cause false canary failures.

BREAKING CHANGE: ChunkManifest gains a required `preprocess` field.
Providers on v0.3 will reject v0.4 manifests. Bump both sides together
and republish catalog entries with the spec hash.
```

Also flag a breaking change when the on-chain message shape changes, since older receipts on HCS stay readable forever and consumers need to handle both versions.

## Atomic commits

One commit, one logical change. If the subject line needs "and", split it.

Use `git add -p` when a working tree has drifted into several concerns. A commit that adds lease reclaim, fixes a typo, and bumps a dependency is three commits.

Two exceptions worth taking: a fix plus the test that proves it belong together, and a rename plus its call-site updates belong together.

## Examples

**Adding a capability**

```
feat(engine): batch inference at 8-32 items per forward pass

Vision models have no cross-item dependency, so batching is
deterministic per item. Roughly 3x throughput on YOLOv8n over
single-item inference on M2.
```

**Fixing wrong behaviour**

```
fix(hedera): associate token before first transfer

Settlement failed with TOKEN_NOT_ASSOCIATED_TO_ACCOUNT on every fresh
provider. Association now runs during registration, before any stake
transfer is attempted.
```

**Restructuring**

```
refactor(buyer): extract orchestrator into a library

The orchestrator ran as a service, which put chunk dispatch behind a
process the buyer had to trust. It is now a module the buyer imports,
so no third party holds job state or custody.
```

**Measured performance work**

```
perf(engine): decode JPEGs with TurboJPEG instead of Pillow

Decode dominated the pipeline at 61% of wall time on a 5000-image job.
TurboJPEG drops that to 24%; end-to-end throughput up from 31 to 52
images/sec on M2 16GB.
```

**Documentation**

```
docs: add threat model and verification limits

States plainly that the system provides canary-verified outputs and
economic guarantees, not proof of computation, and that stake is
currently custodial.
```

**Revert**

```
revert: "feat(provider): stream results over websocket"

This reverts commit 4a91c3e. Reconnect handling dropped results when a
laptop changed networks mid-chunk. Returning to callback POST until
resumable delivery exists.
```

## Branches

```
<type>/<short-kebab-description>
```

`feat/work-stealing-orchestrator`, `fix/token-association`, `docs/threat-model`.

Keep branches short-lived. On a hackathon timeline, a branch open longer than a day is usually a sign the change should have been split.

## Tags

Tag the qualification checkpoint the moment it passes — one buyer, one provider, one paid chunk, receipt on HCS:

```bash
git tag -a v0.1.0-qualified -m "Qualification requirements met: live x402 service, one paid request end to end, receipt on HCS"
```

This is worth doing because it marks the point where the submission became valid. Everything after is upside, and having it tagged means a bad day later can't cost the submission.

Thereafter use semver: `feat` bumps minor, `fix` and `perf` bump patch, `!` bumps major.

## Common situations

**Committing work in progress.** Prefer not to. If you must, use `chore: wip <area>` and squash before pushing. Never leave `wip` in the history a reviewer reads.

**Amending.** Safe on unpushed commits. Once pushed to a shared branch, add a new commit instead — rewriting shared history costs more time than a slightly untidy log.

**Squashing.** Squash a branch's noise into logical commits before merging, but don't flatten a whole feature into one commit. A reviewer learns more from four honest commits than from one 2000-line commit called "add marketplace".

**Generated files.** `pnpm-lock.yaml` is committed. `.venv/`, `node_modules/`, `~/.dcm/` cache contents, and compiled CoreML artifacts are not.

**Nothing to say in the body.** Then don't write one. A padded body is worse than no body. `test(protocol): add canonical JSON round-trip test` needs nothing further.