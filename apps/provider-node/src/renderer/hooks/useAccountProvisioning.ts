import { useEffect, useRef, useState } from "react";
import type { ConnectedWallet } from "@privy-io/react-auth";
import type { Settings } from "../../main/settings-store";

export type ProvisioningState = { status: "idle" | "provisioning" | "done" | "error"; error?: string };

/**
 * Once logged in with an embedded wallet and no account id saved yet, creates and funds a fresh
 * Hedera account for it automatically — see main/account-provisioning.ts for what that actually
 * does and its one real dependency (this project's own OPERATOR identity as the one-time payer).
 */
export function useAccountProvisioning(
  settings: Settings | null,
  save: (patch: Partial<Settings>) => Promise<Settings>,
  embeddedWallet: ConnectedWallet | undefined,
): ProvisioningState {
  const [state, setState] = useState<ProvisioningState>({ status: "idle" });
  const started = useRef(false);

  useEffect(() => {
    if (!settings || !embeddedWallet || settings.accountId || started.current) return;
    started.current = true;
    setState({ status: "provisioning" });

    const tokenIds = [...new Set([...settings.associateTokenIds, ...(settings.computeTokenId ? [settings.computeTokenId] : [])])];
    window.decomp
      .provisionAccount(embeddedWallet.address, tokenIds)
      .then(async ({ accountId }) => {
        await save({ accountId, embeddedWalletAddress: embeddedWallet.address });
        setState({ status: "done" });
      })
      .catch((error: unknown) => {
        started.current = false;
        setState({ status: "error", error: error instanceof Error ? error.message : String(error) });
      });
  }, [settings, embeddedWallet, save]);

  return state;
}
