import { useEffect, useRef, useState } from "react";
import type { ConnectedWallet } from "@privy-io/react-auth";
import type { Settings } from "../../main/settings-store";

export type ProvisioningState = { status: "idle" | "provisioning" | "done" | "error"; error?: string };

/**
 * Once logged in with an embedded wallet that doesn't match the saved account id's wallet yet,
 * creates and funds a fresh Hedera account for it automatically — see main/account-provisioning.ts
 * for what that actually does and its one real dependency (this project's own OPERATOR identity as
 * the one-time payer). Re-provisions on switching to a different Google/Privy login too: the saved
 * accountId is keyed to whichever embedded wallet provisioned it, so signing in with a different
 * account (a new embedded wallet address) needs its own fresh account, not the previous one's —
 * without this, every screen that signs or lists (Go live, Engine) would keep acting as the old
 * account while showing the newly logged-in wallet, which is exactly the mismatch the Settings
 * screen warns about.
 */
export function useAccountProvisioning(
  settings: Settings | null,
  save: (patch: Partial<Settings>) => Promise<Settings>,
  embeddedWallet: ConnectedWallet | undefined,
): ProvisioningState {
  const [state, setState] = useState<ProvisioningState>({ status: "idle" });
  // Keyed by wallet address rather than a plain boolean so switching to a different embedded
  // wallet (a different login) re-triggers provisioning instead of being permanently skipped by a
  // stale "already started" flag left over from the first login this session.
  const startedForAddress = useRef<string | null>(null);

  useEffect(() => {
    if (!settings || !embeddedWallet) return;
    const alreadyProvisioned = settings.accountId && settings.embeddedWalletAddress?.toLowerCase() === embeddedWallet.address.toLowerCase();
    if (alreadyProvisioned || startedForAddress.current === embeddedWallet.address) return;
    startedForAddress.current = embeddedWallet.address;
    setState({ status: "provisioning" });

    const tokenIds = [...new Set([...settings.associateTokenIds, ...(settings.computeTokenId ? [settings.computeTokenId] : [])])];
    window.decomp
      .provisionAccount(embeddedWallet.address, tokenIds)
      .then(async ({ accountId }) => {
        await save({ accountId, embeddedWalletAddress: embeddedWallet.address });
        setState({ status: "done" });
      })
      .catch((error: unknown) => {
        startedForAddress.current = null;
        setState({ status: "error", error: error instanceof Error ? error.message : String(error) });
      });
  }, [settings, embeddedWallet, save]);

  return state;
}
