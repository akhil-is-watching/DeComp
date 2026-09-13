import { useCallback, useEffect, useState } from "react";
import type { NodeRunState, ProcessName } from "../../main/node-supervisor";

const STOPPED: NodeRunState = { running: false, runner: "stopped", provider: "stopped", reachableAt: null, error: null };

export type NodeLogLine = { name: ProcessName; line: string; at: number };

/** Live state of the runner/provider the app supervises, pushed from main as the children move. */
export function useNodeRun() {
  const [state, setState] = useState<NodeRunState>(STOPPED);
  const [log, setLog] = useState<NodeLogLine[]>([]);
  const [busy, setBusy] = useState(false);

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

  return { state, log, busy, start, stop };
}
