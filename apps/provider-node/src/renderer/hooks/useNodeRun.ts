import { useCallback, useEffect, useState } from "react";
import type { NodeRunState, ProcessName, RunnerPathStatus } from "../../main/node-supervisor";

const STOPPED: NodeRunState = { running: false, runner: "stopped", provider: "stopped", reachableAt: null, error: null };

export type NodeLogLine = { name: ProcessName; line: string; at: number };

/** Live state of the runner/provider the app supervises, pushed from main as the children move. */
export function useNodeRun(runnerPath?: string | null) {
  const [state, setState] = useState<NodeRunState>(STOPPED);
  const [log, setLog] = useState<NodeLogLine[]>([]);
  const [runner, setRunner] = useState<RunnerPathStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [setupMessage, setSetupMessage] = useState<string | null>(null);

  useEffect(() => {
    void window.decomp.getNodeState().then(setState);
    void window.decomp.getNodeLog().then(setLog);
    // Transitions (a process becoming ready, a line worth showing) are the child's schedule, not
    // the renderer's — re-read the log every time main says something changed rather than polling.
    return window.decomp.onNodeChanged(next => {
      setState(next);
      void window.decomp.getNodeLog().then(setLog);
    });
  }, []);

  // Re-checked when the path or the run state changes, so the checklist knows what's missing
  // before the user presses anything rather than after.
  const refreshRunner = useCallback(() => {
    void window.decomp.checkRunnerPath(runnerPath ?? null).then(setRunner);
  }, [runnerPath]);

  useEffect(refreshRunner, [refreshRunner, state.running]);

  const setup = useCallback(async () => {
    setBusy(true);
    setSetupMessage("installing Python, MLX and PyTorch — this takes a few minutes");
    try {
      const result = await window.decomp.setupRunner();
      setSetupMessage(result.ok ? null : result.message);
      refreshRunner();
    } finally {
      setBusy(false);
    }
  }, [refreshRunner]);

  const start = useCallback(async () => {
    setBusy(true);
    try {
      setState(await window.decomp.startNode());
    } catch (error) {
      setState(s => ({ ...s, error: error instanceof Error ? error.message : String(error) }));
    } finally {
      setBusy(false);
    }
  }, []);

  const stop = useCallback(async () => {
    setBusy(true);
    try {
      await window.decomp.stopNode();
    } finally {
      setBusy(false);
    }
  }, []);

  return { state, log, runner, busy, setupMessage, setup, start, stop };
}
