/**
 * The /authorize page. Fetches this app's public Privy app id, runs Privy's login widget, then
 * POSTs the resulting Privy access token to /authorize/callback (which re-validates client_id and
 * redirect_uri server-side — see oauth/authorize.ts) and navigates to whatever it returns. The
 * OAuth request's own query string (client_id, redirect_uri, code_challenge, ...) is never parsed
 * or trusted here beyond passing it through — validation and the final redirect decision both
 * happen server-side.
 */
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { PrivyProvider, usePrivy } from "@privy-io/react-auth";

const params = new URLSearchParams(window.location.search);
const oauthRequest = {
  client_id: params.get("client_id") ?? "",
  redirect_uri: params.get("redirect_uri") ?? "",
  code_challenge: params.get("code_challenge") ?? "",
  code_challenge_method: params.get("code_challenge_method") ?? "",
  state: params.get("state") ?? undefined,
  resource: params.get("resource") ?? undefined,
};

function Login() {
  const { ready, authenticated, login, getAccessToken } = usePrivy();
  const [status, setStatus] = useState<"idle" | "working" | "error">("idle");
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!ready || !authenticated || status !== "idle") return;
    setStatus("working");
    (async () => {
      const privyAccessToken = await getAccessToken();
      if (!privyAccessToken) throw new Error("Privy did not return an access token");
      const res = await fetch("/authorize/callback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...oauthRequest, privyAccessToken }),
      });
      const body = (await res.json()) as { redirect?: string; error_description?: string; error?: string };
      if (!res.ok || !body.redirect) throw new Error(body.error_description ?? body.error ?? `HTTP ${res.status}`);
      window.location.href = body.redirect;
    })().catch(err => {
      setStatus("error");
      setError(err instanceof Error ? err.message : String(err));
    });
  }, [ready, authenticated, status, getAccessToken]);

  if (!oauthRequest.client_id || !oauthRequest.redirect_uri || !oauthRequest.code_challenge) {
    return <p>This page is opened by an app connecting to DeComp, not visited directly.</p>;
  }
  if (!ready) return <p>Loading…</p>;
  if (status === "error") return <p>Sign-in failed: {error}</p>;
  if (authenticated || status === "working") return <p>Signing you in…</p>;
  return (
    <div>
      <h1>Sign in to DeComp</h1>
      <p>This connects your DeComp wallet to the app that sent you here.</p>
      <button onClick={login}>Sign in with Privy</button>
    </div>
  );
}

async function main() {
  const { privyAppId } = (await (await fetch("/connector-config")).json()) as { privyAppId: string };
  createRoot(document.getElementById("root")!).render(
    <PrivyProvider appId={privyAppId} config={{ loginMethods: ["email", "google"] }}>
      <Login />
    </PrivyProvider>,
  );
}

void main();
