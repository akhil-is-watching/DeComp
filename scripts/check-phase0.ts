/** Phase 0 gate: facilitator reachable, Privy wallets key their accounts, GPU backends usable, workspace installs. */
import { join } from "node:path";
import { $ } from "bun";
import { formatTinybars, getHbarBalance, mirrorGet, networkConfig } from "@decomp/hedera-x402";
import { privyClientFromEnv, walletFromEnv } from "@decomp/privy-hedera";

const root = join(import.meta.dir, "..");
const python = join(root, "services", "job-runner", ".venv", "bin", "python");
const { network, facilitatorUrl } = networkConfig();
const ROLES = ["OPERATOR", "AGENT", "PROVIDER_1", "PROVIDER_2", "PROVIDER_3"];

const checks: [name: string, run: () => Promise<string>][] = [
  [
    `facilitator advertises ${network} with a feePayer`,
    async () => {
      const res = await fetch(`${facilitatorUrl}/supported`, { signal: AbortSignal.timeout(15_000) });
      const body = (await res.json()) as { kinds: { network: string; scheme: string; extra?: { feePayer?: string } }[] };
      const kind = body.kinds.find(k => k.network === network && k.scheme === "exact");
      if (!kind?.extra?.feePayer) throw new Error(`no exact ${network} kind with feePayer in ${JSON.stringify(body.kinds)}`);
      return `feePayer ${kind.extra.feePayer}`;
    },
  ],
  ...ROLES.map((role): [string, () => Promise<string>] => [
    `${role} signs with its Privy wallet and has HBAR`,
    async () => {
      const privy = privyClientFromEnv();
      const wallet = await walletFromEnv(privy, role);
      // The account must be keyed to the wallet, or nothing it signs will be accepted.
      const account = await mirrorGet<{ key: { key: string } | null }>(`/api/v1/accounts/${wallet.accountId}`);
      const onChain = account.key?.key?.toLowerCase();
      if (!onChain || !wallet.publicKey.toStringRaw().toLowerCase().endsWith(onChain)) {
        throw new Error(`${wallet.accountId} is not keyed to Privy wallet ${wallet.walletId} — re-run \`bun run setup:privy\``);
      }
      const balance = await getHbarBalance(wallet.accountId);
      if (balance <= 0n) throw new Error(`${wallet.accountId} balance is 0`);
      return `${wallet.accountId} ${formatTinybars(balance)} via wallet ${wallet.walletId}`;
    },
  ]),
  [
    "MLX default device is a GPU",
    async () => {
      const out = (await $`${python} -c ${"import mlx.core as mx; print(mx.default_device())"}`.quiet().text()).trim();
      if (!out.includes("gpu")) throw new Error(out);
      return out;
    },
  ],
  [
    "PyTorch MPS backend is available",
    async () => {
      const out = (await $`${python} -c ${"import torch; print(torch.backends.mps.is_available())"}`.quiet().text()).trim();
      if (out !== "True") throw new Error(out);
      return out;
    },
  ],
  [
    "bun workspace installs from the lockfile",
    async () => {
      await $`bun install --frozen-lockfile`.cwd(root).quiet();
      return `bun ${Bun.version}`;
    },
  ],
];

let failed = 0;
for (const [name, run] of checks) {
  try {
    console.log(`PASS  ${name} — ${await run()}`);
  } catch (error) {
    failed++;
    const message = error instanceof $.ShellError ? error.stderr.toString().trim() : String(error instanceof Error ? error.message : error);
    console.log(`FAIL  ${name} — ${message.split("\n").slice(-3).join(" ")}`);
  }
}
console.log(failed ? `\n${failed} check(s) failed — do not start Phase 1.` : "\nPhase 0 gate passed.");
process.exit(failed ? 1 : 0);
