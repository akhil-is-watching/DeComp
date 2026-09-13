import { useCallback, useEffect, useState } from "react";
import type { Settings } from "../../main/settings-store";

export function useSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    (async () => {
      const [loaded, envConfig] = await Promise.all([window.decomp.getSettings(), window.decomp.getEnvConfig()]);
      // Fill in whatever the user hasn't customized yet from the monorepo's own .env — public
      // config (topic/token ids, network), not asked for again if it's already set.
      const patch: Partial<Settings> = {};
      if (loaded.registryTopicId === null && envConfig.registryTopicId) patch.registryTopicId = envConfig.registryTopicId;
      if (loaded.auditTopicId === null && envConfig.auditTopicId) patch.auditTopicId = envConfig.auditTopicId;
      if (loaded.computeTokenId === null && envConfig.computeTokenId) patch.computeTokenId = envConfig.computeTokenId;
      if (loaded.associateTokenIds.length === 0 && envConfig.associateTokenIds.length > 0) patch.associateTokenIds = envConfig.associateTokenIds;
      if (loaded.network === "hedera:testnet" && envConfig.network === "hedera:mainnet") patch.network = envConfig.network;

      if (Object.keys(patch).length > 0) {
        setSettings(await window.decomp.saveSettings(patch));
      } else {
        setSettings(loaded);
      }
    })();
  }, []);

  const save = useCallback(async (patch: Partial<Settings>) => {
    const saved = await window.decomp.saveSettings(patch);
    setSettings(saved);
    return saved;
  }, []);

  return { settings, save };
}
