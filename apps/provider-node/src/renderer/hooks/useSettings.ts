import { useCallback, useEffect, useState } from "react";
import type { Settings } from "../../main/settings-store";

export function useSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    window.decomp.getSettings().then(setSettings);
  }, []);

  const save = useCallback(async (patch: Partial<Settings>) => {
    const saved = await window.decomp.saveSettings(patch);
    setSettings(saved);
    return saved;
  }, []);

  return { settings, save };
}
