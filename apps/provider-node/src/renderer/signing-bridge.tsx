/**
 * Registers this window's ability to answer a main-process sign request, for as long as an
 * embedded wallet is available. Mount once, near the root — it renders nothing.
 */
import { useEffect } from "react";
import { useWallets } from "@privy-io/react-auth";

export function SigningBridge() {
  const { wallets } = useWallets();
  const embeddedWallet = wallets.find(w => w.walletClientType === "privy");

  useEffect(() => {
    if (!embeddedWallet) {
      window.decomp.setSignHandler(null);
      return;
    }
    window.decomp.setSignHandler(async hashHex => {
      try {
        const provider = await embeddedWallet.getEthereumProvider();
        const signatureHex = (await provider.request({ method: "secp256k1_sign", params: [hashHex] })) as string;
        return { ok: true, signatureHex };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    });
    return () => window.decomp.setSignHandler(null);
  }, [embeddedWallet]);

  return null;
}
