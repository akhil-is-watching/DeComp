import { useCallback, useEffect, useState } from "react";
import type { NodeRunState } from "../../main/node-supervisor";

const STOPPED: NodeRunState = { running: false, runner: "stopped", provider: "stopped", reachableAt: null, error: null };

/** Live state of the runner/provider the app supervises, pushed from main as the children move. */
export function useNodeRun() {
  const [state, setState] = useState<NodeRunState>(STOPPED);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void window.decomp.getNodeState().then(setState);
    return window.decomp.onNodeChanged(setState);
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

  return { state, busy, start, stop };
}
