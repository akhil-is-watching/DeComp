import { useEffect, useState } from "react";
import type { AuditEntry } from "@decomp/hcs-registry";

export type AuditHistoryState = { loading: boolean; error: string | null; entries: AuditEntry[] };

/** Fetches this account's audit history once (shared by Job History and Reward History, so the topic is only read once). */
export function useAuditHistory(auditTopicId: string | null, accountId: string | null): AuditHistoryState {
  const [state, setState] = useState<AuditHistoryState>({ loading: true, error: null, entries: [] });

  useEffect(() => {
    if (!auditTopicId || !accountId) {
      setState({ loading: false, error: null, entries: [] });
      return;
    }
    let cancelled = false;
    setState(s => ({ ...s, loading: true, error: null }));
    window.decomp
      .getProviderAudits(auditTopicId, accountId)
      .then(entries => {
        if (!cancelled) setState({ loading: false, error: null, entries });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ loading: false, error: error instanceof Error ? error.message : String(error), entries: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [auditTopicId, accountId]);

  return state;
}
