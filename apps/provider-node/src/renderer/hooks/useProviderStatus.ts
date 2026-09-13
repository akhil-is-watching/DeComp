import { useCallback, useEffect, useRef, useState } from "react";
import type { ProviderStatus } from "../../main/provider-process";
import type { StartProviderOptions } from "../../main/ipc/provider-control-ipc";

const MAX_LOG_LINES = 500;

export function useProviderStatus() {
  const [status, setStatus] = useState<ProviderStatus>({ running: false, port: null });
  const [logs, setLogs] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    window.decomp.getProviderStatus().then(s => mounted.current && setStatus(s));
    const unsubscribe = window.decomp.onProviderLog(line => {
      if (!mounted.current) return;
      setLogs(prev => (prev.length >= MAX_LOG_LINES ? [...prev.slice(1), line] : [...prev, line]));
    });
    return () => {
      mounted.current = false;
      unsubscribe();
    };
  }, []);

  const start = useCallback(async (options: StartProviderOptions) => {
    setStarting(true);
    setError(null);
    try {
      await window.decomp.startProvider(options);
      setStatus(await window.decomp.getProviderStatus());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStarting(false);
    }
  }, []);

  const stop = useCallback(async () => {
    await window.decomp.stopProvider();
    setStatus(await window.decomp.getProviderStatus());
  }, []);

  return { status, logs, error, starting, start, stop };
}
