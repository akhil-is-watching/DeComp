/**
 * One source of truth for everything the dashboard reads: local settings plus the three
 * mirror-node/HCS reads behind them.
 *
 * Previously each screen called useSettings() and useAuditHistory() for itself, so the audit
 * topic was re-read on every tab switch, a save on Settings left the other screens showing stale
 * config, and two screens could disagree about the account id. One provider, one fetch, one
 * refresh clock.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { AuditEntry, RegistryEntry } from "@decomp/hcs-registry";
import type { Settings } from "../../main/settings-store";
import type { BalanceSnapshot } from "../../main/mirror-reads";

/** Long enough not to hammer the public mirror node; short enough that a finished job shows up. */
const REFRESH_MS = 60_000;

export type AppData = {
  settings: Settings | null;
  save: (patch: Partial<Settings>) => Promise<Settings>;
  balance: BalanceSnapshot | null;
  audits: AuditEntry[];
  registry: RegistryEntry[];
  /** True only for the very first load — a refresh holds the previous render instead of flashing. */
  initialLoading: boolean;
  refreshing: boolean;
  error: string | null;
  refreshedAt: Date | null;
  refresh: () => void;
};

const Context = createContext<AppData | null>(null);

export function useAppData(): AppData {
  const value = useContext(Context);
  if (!value) throw new Error("useAppData must be used inside <AppDataProvider>");
  return value;
}

/** Settings alone, for the screens that only configure — same object as useAppData().settings. */
export function useSettings(): { settings: Settings | null; save: AppData["save"] } {
  const { settings, save } = useAppData();
  return { settings, save };
}

export function AppDataProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [balance, setBalance] = useState<BalanceSnapshot | null>(null);
  const [audits, setAudits] = useState<AuditEntry[]>([]);
  const [registry, setRegistry] = useState<RegistryEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);
  const [nonce, setNonce] = useState(0);
  const inFlight = useRef(false);

  useEffect(() => {
    void (async () => {
      const [stored, envConfig] = await Promise.all([window.decomp.getSettings(), window.decomp.getEnvConfig()]);
      // Fill in whatever the user hasn't customized yet from the monorepo's own .env — public
      // config (topic/token ids, network), not asked for again if it's already set.
      const patch: Partial<Settings> = {};
      if (stored.registryTopicId === null && envConfig.registryTopicId) patch.registryTopicId = envConfig.registryTopicId;
      if (stored.auditTopicId === null && envConfig.auditTopicId) patch.auditTopicId = envConfig.auditTopicId;
      if (stored.computeTokenId === null && envConfig.computeTokenId) patch.computeTokenId = envConfig.computeTokenId;
      if (stored.associateTokenIds.length === 0 && envConfig.associateTokenIds.length > 0) patch.associateTokenIds = envConfig.associateTokenIds;
      if (stored.network === "hedera:testnet" && envConfig.network === "hedera:mainnet") patch.network = envConfig.network;

      setSettings(Object.keys(patch).length > 0 ? await window.decomp.saveSettings(patch) : stored);
    })();
  }, []);

  const save = useCallback(async (patch: Partial<Settings>) => {
    const saved = await window.decomp.saveSettings(patch);
    setSettings(saved);
    return saved;
  }, []);

  const settingsLoaded = settings !== null;
  const accountId = settings?.accountId ?? null;
  const network = settings?.network ?? null;
  const auditTopicId = settings?.auditTopicId ?? null;
  const registryTopicId = settings?.registryTopicId ?? null;
  const computeTokenId = settings?.computeTokenId ?? null;

  useEffect(() => {
    if (!accountId || !network) {
      if (settingsLoaded) setLoaded(true);
      return;
    }
    let cancelled = false;
    inFlight.current = true;
    setRefreshing(true);

    void (async () => {
      // Settled, not all: one unreachable read (an unset topic, a mirror-node hiccup) shouldn't
      // blank out the two that did come back.
      const [balanceResult, auditResult, registryResult] = await Promise.allSettled([
        window.decomp.getBalance(accountId, network, computeTokenId ?? undefined),
        auditTopicId ? window.decomp.getProviderAudits(auditTopicId, accountId, network) : Promise.resolve([]),
        registryTopicId ? window.decomp.getRegistry(registryTopicId, network) : Promise.resolve([]),
      ]);
      if (cancelled) return;

      if (balanceResult.status === "fulfilled") setBalance(balanceResult.value);
      if (auditResult.status === "fulfilled") setAudits(auditResult.value);
      if (registryResult.status === "fulfilled") setRegistry(registryResult.value);

      const failure = [balanceResult, auditResult, registryResult].find(r => r.status === "rejected");
      setError(failure ? describe((failure as PromiseRejectedResult).reason) : null);
      setRefreshedAt(new Date());
      setLoaded(true);
      setRefreshing(false);
      inFlight.current = false;
    })();

    return () => {
      cancelled = true;
    };
    // Deliberately keyed on the inputs the reads actually use, not the whole settings object:
    // saving an unrelated field (a node name, a runner path) must not re-read the topic. Network
    // is in here so switching it refetches everything against the other network immediately.
  }, [accountId, network, auditTopicId, registryTopicId, computeTokenId, settingsLoaded, nonce]);

  const refresh = useCallback(() => {
    if (!inFlight.current) setNonce(n => n + 1);
  }, []);

  useEffect(() => {
    const timer = setInterval(refresh, REFRESH_MS);
    // Coming back to the app is exactly when stale numbers are most obvious.
    window.addEventListener("focus", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [refresh]);

  const value = useMemo<AppData>(
    () => ({
      settings,
      save,
      balance,
      audits,
      registry,
      initialLoading: !settings || !loaded,
      refreshing,
      error,
      refreshedAt,
      refresh,
    }),
    [settings, save, balance, audits, registry, loaded, refreshing, error, refreshedAt, refresh],
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
