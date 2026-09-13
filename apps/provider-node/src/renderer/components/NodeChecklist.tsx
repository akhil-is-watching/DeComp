/**
 * The dashboard's lead and the app's core loop: everything between this Mac and a paid job, in
 * order, with the next action attached.
 *
 * The steps aren't discoverable on their own — being listed and being able to answer are different
 * things, and the second needs a GPU runner. All three are actionable here, including the runner
 * setup, so nobody has to be told what to do next or sent to a terminal.
 *
 * Exactly one step is "next": it gets the accent panel and the primary button, later steps dim,
 * finished ones collapse to a tick. The Engine tab still owns the detail — per-process state and
 * logs; this owns the decision.
 */
import type { RegistryEntry } from "@decomp/hcs-registry";
import type { NodeRunState, RunnerPathStatus } from "../../main/node-supervisor";
import type { NetworkActivity } from "../../main/mirror-reads";
import { Button } from "./Button";
import { IconBolt, IconCheck, IconCpu, IconGauge } from "./icons";
import { hbar } from "../lib/format";

type Step = {
  id: string;
  title: string;
  done: string | null;
  todo: string;
  actionLabel: string;
  doneLabel?: string;
  onAction: () => void;
  busy?: boolean;
  icon: React.ReactNode;
};

export function NodeChecklist({
  listing,
  run,
  runner,
  network,
  busy,
  setupMessage,
  onGoLive,
  onSetupRunner,
  onStart,
  onStop,
  onOpenEngine,
}: {
  listing: RegistryEntry | null;
  run: NodeRunState;
  runner: RunnerPathStatus | null;
  network: NetworkActivity;
  busy: boolean;
  setupMessage: string | null;
  onGoLive: () => void;
  onSetupRunner: () => void;
  onStart: () => void;
  onStop: () => void;
  onOpenEngine: () => void;
}) {
  const serving = run.provider === "ready";
  // An unset path still defaults to a dev checkout, which startNode resolves the same way — only
  // a checkout that exists without a runner is a step the user has to act on.
  const runnerMissing = runner !== null && runner.root !== null && !runner.pythonReady;

  const steps: Step[] = [
    {
      id: "listed",
      title: "Get on the market",
      done: listing ? `Listed as ${listing.providerId}` : null,
      todo: "Publish a listing so agents can discover this Mac.",
      actionLabel: "Go live",
      doneLabel: "Update",
      onAction: onGoLive,
      icon: <IconBolt size={13} />,
    },
    {
      id: "runner",
      title: "Install the GPU runner",
      done: runnerMissing ? null : "Installed",
      todo: setupMessage ?? "Sets up Python, MLX and PyTorch for you — a few minutes, once.",
      actionLabel: busy ? "Installing…" : "Set up runner",
      onAction: onSetupRunner,
      busy,
      icon: <IconGauge size={13} />,
    },
    {
      id: "serving",
      title: "Answer jobs",
      done: serving ? (run.reachableAt ?? "Connected to the bridge") : null,
      todo: run.running ? "Starting the GPU runner and provider…" : "Start the node so agents that find you get an answer.",
      actionLabel: run.running ? "Stop node" : "Start node",
      doneLabel: "Stop node",
      onAction: run.running ? onStop : onStart,
      busy,
      icon: <IconCpu size={13} />,
    },
  ];

  const nextIndex = steps.findIndex(step => step.done === null);
  const allDone = nextIndex === -1;
  const paid = BigInt(network.paidTinybars24h);

  return (
    <section className="card" style={{ padding: 0, overflow: "hidden" }}>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
          padding: "14px 20px",
          borderBottom: "1px solid var(--line)",
          background: "var(--surface-sunken)",
        }}
      >
        <span style={{ fontSize: 11.5, letterSpacing: "0.09em", textTransform: "uppercase", color: "var(--muted)" }}>
          {allDone ? "This Mac is earning" : `Get paid for this GPU · ${steps.filter(s => s.done).length} of ${steps.length}`}
        </span>
        {/* Real figures off the audit topic, not a manufactured nudge: a quiet market says nothing,
            and a node that's already earning doesn't need chasing. */}
        {network.jobs24h > 0 && !allDone && (
          <span style={{ fontSize: 12.5, color: "var(--muted)" }}>
            <span style={{ color: "var(--accent)" }}>{hbar(paid, 2)} ℏ</span> paid across {network.jobs24h} job
            {network.jobs24h === 1 ? "" : "s"} in the last 24h — none of it to you
          </span>
        )}
        {allDone && (
          <button className="link" onClick={onOpenEngine} style={{ fontSize: 12.5 }}>
            Engine &rarr;
          </button>
        )}
      </header>

      <ol style={{ margin: 0, padding: 0, listStyle: "none" }}>
        {steps.map((step, i) => {
          const done = step.done !== null;
          const isNext = i === nextIndex;

          return (
            <li
              key={step.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 16,
                padding: isNext ? "20px" : "14px 20px",
                borderTop: i === 0 ? "none" : "1px solid var(--line)",
                background: isNext ? "linear-gradient(100deg, var(--accent-softer), transparent 70%)" : undefined,
                opacity: nextIndex !== -1 && i > nextIndex ? 0.45 : 1,
                transition: "opacity 200ms var(--ease)",
              }}
            >
              <span
                aria-hidden
                style={{
                  display: "grid",
                  placeItems: "center",
                  width: 26,
                  height: 26,
                  borderRadius: 999,
                  flexShrink: 0,
                  color: done ? "var(--viz-good)" : isNext ? "var(--accent)" : "var(--muted)",
                  border: `1px solid ${
                    done
                      ? "color-mix(in srgb, var(--viz-good) 40%, transparent)"
                      : isNext
                        ? "color-mix(in srgb, var(--accent) 45%, transparent)"
                        : "var(--line)"
                  }`,
                  background: isNext ? "var(--accent-softer)" : "transparent",
                }}
              >
                {done ? <IconCheck size={14} /> : step.icon}
              </span>

              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: isNext ? 16 : 14, color: done || isNext ? "var(--text)" : "var(--muted-bright)" }}>{step.title}</div>
                <div
                  className={done && step.done?.startsWith("http") ? "mono" : undefined}
                  style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 3, wordBreak: "break-all", lineHeight: 1.6 }}
                >
                  {done ? step.done : step.todo}
                </div>
              </div>

              {isNext && (
                <Button onClick={step.onAction} disabled={step.busy} style={{ flexShrink: 0 }}>
                  {step.actionLabel}
                </Button>
              )}
              {done && step.doneLabel && (
                <button className="chip" onClick={step.onAction} disabled={step.busy} style={{ flexShrink: 0 }}>
                  {step.doneLabel}
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
