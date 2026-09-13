/**
 * Publishes this node's listing to the registry. The app is otherwise read-only, so this is the
 * one screen that writes to the chain on the user's behalf — it says plainly what that costs and,
 * more importantly, what it commits them to.
 */
import { useMemo, useState } from "react";
import { useWallets } from "@privy-io/react-auth";
import { TINYBARS_PER_HBAR } from "@decomp/hedera-x402";
import type { JobTypeOffer } from "@decomp/hcs-registry";
import { Card } from "../components/Surface";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { ExternalLink } from "../components/ExternalLink";
import { IconAlert, IconBroadcast } from "../components/icons";
import { useAppData } from "../state/AppData";

/** The job types the runner actually implements (services/job-runner). Nothing else would run. */
const JOB_TYPES = [
  { name: "benchmark", blurb: "dense matmul on MLX or PyTorch MPS" },
  { name: "mandelbrot", blurb: "renders a PNG at up to 4096²" },
] as const;

const TICK_SECONDS = 5;
const DEFAULT_HBAR_PER_SECOND = 0.0125;

export function GoLive({ onDone }: { onDone: () => void }) {
  const { settings, refresh } = useAppData();
  const { wallets } = useWallets();
  const [selected, setSelected] = useState<string[]>(["benchmark", "mandelbrot"]);
  const [rate, setRate] = useState(String(DEFAULT_HBAR_PER_SECOND));
  const [state, setState] = useState<{ status: "idle" | "publishing" | "error"; error?: string }>({ status: "idle" });

  const embeddedWallet = wallets.find(w => w.walletClientType === "privy");
  const perSecond = Number(rate);
  const tinybars = useMemo(
    () => (Number.isFinite(perSecond) && perSecond > 0 ? BigInt(Math.round(perSecond * Number(TINYBARS_PER_HBAR))) : 0n),
    [perSecond],
  );

  if (!settings) return null;

  const endpoint = settings.bridgeUrl ? `${settings.bridgeUrl.replace(/\/$/, "")}/p/${settings.accountId}` : null;
  const blocked =
    !settings.accountId
      ? "This node has no Hedera account yet."
      : !settings.registryTopicId
        ? "No registry topic is configured, so there's nowhere to publish."
        : !endpoint
          ? "Set a bridge URL in Settings — a listing has to advertise an endpoint agents can reach."
          : !embeddedWallet
            ? "Your wallet session isn't available; sign out and back in."
            : selected.length === 0
              ? "Pick at least one job type."
              : tinybars <= 0n
                ? "Set a price above zero."
                : null;

  async function publish() {
    if (blocked || !settings || !endpoint || !embeddedWallet) return;
    setState({ status: "publishing" });
    try {
      const jobTypes: JobTypeOffer[] = selected.map(name => ({
        name,
        pricePerSecTinybars: tinybars.toString(),
        tickSeconds: TICK_SECONDS,
      }));
      await window.decomp.registerProvider({
        registryTopicId: settings.registryTopicId!,
        accountId: settings.accountId!,
        address: embeddedWallet.address,
        providerId: settings.providerName,
        endpoint,
        jobTypes,
        network: settings.network,
      });
      refresh();
      onDone();
    } catch (error) {
      setState({ status: "error", error: error instanceof Error ? error.message : String(error) });
    }
  }

  const publishing = state.status === "publishing";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 620 }}>
      <div>
        <h1 className="font-serif" style={{ margin: 0, fontSize: 32, letterSpacing: "-0.01em" }}>
          Go live
        </h1>
        <p style={{ margin: "6px 0 0", color: "var(--muted)", fontSize: 13.5, lineHeight: 1.7 }}>
          Publishes a signed registration to the registry topic so agents can discover this node.
          Your wallet signs it — that&apos;s what makes the listing yours.
        </p>
      </div>

      {/* The thing most likely to waste someone's time, said before they click. */}
      <Card padding="14px 16px" style={{ borderColor: "color-mix(in srgb, var(--viz-warn) 45%, transparent)" }}>
        <div style={{ display: "flex", gap: 11 }}>
          <IconAlert size={15} style={{ color: "var(--viz-warn)", flexShrink: 0, marginTop: 2 }} />
          <span style={{ fontSize: 13, color: "var(--muted-bright)", lineHeight: 1.7 }}>
            Listing advertises an endpoint agents will send real jobs to. This app doesn&apos;t run
            the job server yet — until something is answering at that address, agents will try you,
            fail, and route to another node.
          </span>
        </div>
      </Card>

      <Card title="What you offer" padding={18}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {JOB_TYPES.map(job => {
            const on = selected.includes(job.name);
            return (
              <label key={job.name} style={{ display: "flex", alignItems: "flex-start", gap: 11, cursor: "default" }}>
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => setSelected(s => (on ? s.filter(n => n !== job.name) : [...s, job.name]))}
                  style={{ marginTop: 3, accentColor: "var(--accent)" }}
                />
                <span>
                  <span className="mono" style={{ fontSize: 13.5, color: on ? "var(--text)" : "var(--muted-bright)" }}>
                    {job.name}
                  </span>
                  <span style={{ display: "block", fontSize: 12.5, color: "var(--muted)", marginTop: 2 }}>{job.blurb}</span>
                </span>
              </label>
            );
          })}
        </div>
      </Card>

      <Card title="Your price" padding={18}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <input
            className="field selectable tabular"
            value={rate}
            onChange={e => setRate(e.target.value)}
            inputMode="decimal"
            style={{ width: 130, fontSize: 15 }}
          />
          <span style={{ fontSize: 13.5, color: "var(--muted)" }}>ℏ per second</span>
        </div>
        <p style={{ margin: "12px 0 0", fontSize: 12.5, color: "var(--muted)", lineHeight: 1.7 }}>
          Billed in {TICK_SECONDS}-second ticks, so one tick costs{" "}
          <span className="tabular" style={{ color: "var(--muted-bright)" }}>
            {(perSecond > 0 ? perSecond * TICK_SECONDS : 0).toFixed(4)} ℏ
          </span>
          . Agents route to the cheapest node offering the job.
        </p>
      </Card>

      <Card title="Advertised endpoint" padding={18}>
        <span className="mono" style={{ fontSize: 13, color: endpoint ? "var(--muted-bright)" : "var(--placeholder)", wordBreak: "break-all" }}>
          {endpoint ?? "no bridge URL set"}
        </span>
      </Card>

      {state.status === "error" && (
        <Card padding="14px 16px" style={{ borderColor: "color-mix(in srgb, var(--viz-crit) 45%, transparent)" }}>
          <span style={{ color: "var(--viz-crit)", fontSize: 13, lineHeight: 1.7 }}>{state.error}</span>
        </Card>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <Button onClick={() => void publish()} disabled={!!blocked || publishing}>
          {publishing ? "signing and publishing…" : "Publish listing"}
        </Button>
        <button className="chip" onClick={onDone} disabled={publishing}>
          Cancel
        </button>
        {blocked && !publishing && <span style={{ fontSize: 12.5, color: "var(--viz-warn)" }}>{blocked}</span>}
        {publishing && <span style={{ fontSize: 12.5, color: "var(--muted)" }}>approve the signature in the app if prompted</span>}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <Badge tone="neutral" dot>
          <IconBroadcast size={11} /> costs a fraction of a cent in HCS fees
        </Badge>
        {settings.registryTopicId && (
          <ExternalLink href={`https://hashscan.io/${settings.network.split(":")[1]}/topic/${settings.registryTopicId}`}>
            the topic it goes to
          </ExternalLink>
        )}
      </div>
    </div>
  );
}
