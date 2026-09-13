import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PrivyProvider } from "@privy-io/react-auth";
import { App } from "./App";
import "./theme/fonts.css";
import "./theme/tokens.css";

async function main() {
  const appId = await window.decomp.getPrivyAppId();
  if (!appId) {
    document.getElementById("root")!.innerText = "PRIVY_APP_ID is not set in the monorepo root .env — see README.";
    return;
  }

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <PrivyProvider
        appId={appId}
        config={{
          loginMethods: ["email", "google"],
          embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" } },
          appearance: { theme: "dark", accentColor: "#c2f24a" },
        }}
      >
        <App />
      </PrivyProvider>
    </StrictMode>,
  );
}

void main();
