import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PrivyProvider } from "@privy-io/react-auth";
import { App } from "./App";
import { AppDataProvider } from "./state/AppData";
import "./theme/fonts.css";
import "./theme/tokens.css";
import "./theme/components.css";

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
          loginMethods: ["email"],
          embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" } },
          appearance: { theme: "dark", accentColor: "#c2f24a" },
        }}
      >
        <AppDataProvider>
          <App />
        </AppDataProvider>
      </PrivyProvider>
    </StrictMode>,
  );
}

void main();
