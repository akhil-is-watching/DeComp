/**
 * Configuration, split by who actually owns each value.
 *
 * Only three fields are the user's to choose: what this node is called, how agents reach it, and
 * where the GPU runner lives on this machine. Everything else is either derived from their wallet
 * at provisioning time (account id, signing wallet) or fixed by the network they joined (topics,
 * token, network) — those are read-only here, because a typo in any of them doesn't reconfigure
 * anything, it just points the app at data that isn't theirs and makes every screen go empty.
 */
import { useEffect, useMemo, useState } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { Card } from "../components/Surface";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { Copyable } from "../components/Copyable";
import { ExternalLink } from "../components/ExternalLink";
import { IconAlert, IconBroadcast, IconCpu, IconUser } from "../components/icons";
import { useAppData } from "../state/AppData";
import { shortAddress } from "../lib/format";
import type { Settings as SettingsType } from "../../main/settings-store";

/** The only fields this screen writes. Anything absent here is read-only by definition. */
const EDITABLE: Partial<Record<keyof SettingsType, string>> = {
  providerName: "node name",
  bridgeUrl: "bridge URL",
  runnerPath: "runner path",
};

export function SettingsScreen() {
  const { settings, save } = useAppData();
  const { wallets } = useWallets();
  const { user } = usePrivy();
  const [draft, setDraft] = useState<SettingsType | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // Take fresh values from the store, but never clobber edits the user hasn't saved yet: the
  // network select writes straight through, so `settings` changes identity mid-edit.
  useEffect(() => {
    setDraft(previous =>
      previous && settings
        ? { ...settings, providerName: previous.providerName, bridgeUrl: previous.bridgeUrl, runnerPath: previous.runnerPath }
        : settings,
    );
  }, [settings]);

  const embeddedWallet = wallets.find(w => w.walletClientType === "privy");
  const dirty = useMemo(() => (draft && settings ? changedKeys(settings, draft) : []), [settings, draft]);

  if (!draft || !settings) return null;

  function update<K extends keyof SettingsType>(key: K, value: SettingsType[K]) {
    setDraft(d => (d ? { ...d, [key]: value } : d));
    setSavedAt(null);
  }

  const explorer = `https://hashscan.io/${draft.network.split(":")[1]}`;
  const nameEmpty = draft.providerName.trim().length === 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22, maxWidth: 760, paddingBottom: dirty.length > 0 ? 76 : 0 }}>
      <div>
        <h1 className="font-serif" style={{ fontSize: 32, letterSpacing: "-0.01em", margin: 0 }}>
          Settings
        </h1>
        <p style={{ margin: "6px 0 0", color: "var(--muted)", fontSize: 13.5 }}>Stored locally on this Mac</p>
      </div>

      {embeddedWallet && draft.embeddedWalletAddress !== embeddedWallet.address && (
        <Card padding="14px 16px" style={{ borderColor: "color-mix(in srgb, var(--viz-warn) 45%, transparent)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
            <IconAlert size={15} style={{ color: "var(--viz-warn)", flexShrink: 0 }} />
            <span style={{ fontSize: 13, color: "var(--muted-bright)", flex: 1 }}>
              The wallet you're signed in with ({shortAddress(embeddedWallet.address, 8, 6)}) isn't the one this node was set up with.
            </span>
          </div>
        </Card>
      )}

      <Group
        icon={<IconCpu size={14} />}
        title="Your node"
        description="The only settings that are yours to choose. Everything below this is read-only."
      >
        <Field label="Node name" hint="what agents see you listed as">
          <input
            className="field selectable"
            value={draft.providerName}
            maxLength={84}
            onChange={e => update("providerName", e.target.value)}
            placeholder="hashir's mac studio"
            style={nameEmpty ? { borderColor: "color-mix(in srgb, var(--viz-warn) 55%, transparent)" } : undefined}
          />
          {nameEmpty && <span style={{ fontSize: 12, color: "var(--viz-warn)" }}>A node with no name can't be listed.</span>}
        </Field>
        <Field label="Bridge URL" hint="leave empty to expose this machine directly">
          <input className="field selectable mono" value={draft.bridgeUrl ?? ""} onChange={e => update("bridgeUrl", e.target.value || null)} placeholder="https://…" />
        </Field>
        <Field label="GPU runner checkout path">
          <input className="field selectable mono" value={draft.runnerPath ?? ""} onChange={e => update("runnerPath", e.target.value || null)} placeholder="/path/to/DeComp/services/job-runner" />
        </Field>
      </Group>

      <Group
        icon={<IconUser size={14} />}
        title="Identity"
        description="Created for you on first sign-in, keyed by your own wallet. Not editable — the account is whatever your wallet's key owns."
      >
        <ReadOnly
          label="Hedera account id"
          value={draft.accountId}
          empty="not provisioned yet"
          hint={draft.accountId && <ExternalLink href={`${explorer}/account/${draft.accountId}`}>View on Hashscan</ExternalLink>}
        />
        <ReadOnly label="Signing wallet" value={draft.embeddedWalletAddress} empty="no wallet recorded" />
      </Group>

      <Group
        icon={<IconBroadcast size={14} />}
        title="Network"
        description="Which Hedera network this node reads from, and the shared ids it reads there. The ids come from the project's .env and are the same for everyone on the network — changing those here would only point this app at data that isn't yours."
      >
        <Field
          label="Hedera network"
          hint="applies immediately"
        >
          <select
            className="field"
            value={draft.network}
            onChange={e => {
              const network = e.target.value as SettingsType["network"];
              setDraft(d => (d ? { ...d, network } : d));
              // Not part of the save bar: this is a mode, not a form field, and the whole
              // dashboard refetches against it the moment it changes.
              void save({ network });
            }}
          >
            <option value="hedera:testnet">hedera:testnet — free HBAR, for trying things out</option>
            <option value="hedera:mainnet">hedera:mainnet — real HBAR, real earnings</option>
          </select>
          <span style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.55 }}>
            Balances, job history and explorer links all follow this. Your account and the topics below exist on one network — the other
            will read empty.
          </span>
        </Field>
        <ReadOnly
          label="Registry topic id"
          value={draft.registryTopicId}
          empty="not set in .env"
          hint={draft.registryTopicId && <ExternalLink href={`${explorer}/topic/${draft.registryTopicId}`}>View topic</ExternalLink>}
        />
        <ReadOnly
          label="Audit topic id"
          value={draft.auditTopicId}
          empty="not set in .env"
          hint={draft.auditTopicId && <ExternalLink href={`${explorer}/topic/${draft.auditTopicId}`}>View topic</ExternalLink>}
        />
        <ReadOnly
          label="Compute token id"
          value={draft.computeTokenId}
          empty="none — HBAR only"
          hint={draft.computeTokenId && <ExternalLink href={`${explorer}/token/${draft.computeTokenId}`}>View token</ExternalLink>}
        />
        <ReadOnly
          label="Associated tokens"
          value={draft.associateTokenIds.length > 0 ? draft.associateTokenIds.join(", ") : null}
          empty="none"
          hint="associated once, when the account was created"
        />
      </Group>

      <Card padding="14px 18px">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, color: "var(--muted)" }}>
            Signed in as <span style={{ color: "var(--muted-bright)" }}>{user?.email?.address ?? user?.id ?? "—"}</span>
          </span>
          <Badge tone="neutral">this app never sees a private key</Badge>
        </div>
      </Card>

      {dirty.length > 0 && (
        <div
          className="rise"
          style={{
            position: "fixed",
            left: 28,
            right: 28,
            bottom: 20,
            zIndex: 5,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 14,
            padding: "12px 16px",
            borderRadius: "var(--r-md)",
            border: "1px solid var(--line-strong)",
            background: "var(--surface-1)",
            boxShadow: "var(--shadow-pop)",
          }}
        >
          <span style={{ fontSize: 13, color: "var(--muted-bright)" }}>
            {dirty.length} unsaved change{dirty.length === 1 ? "" : "s"}
            <span style={{ color: "var(--muted)" }}> · {dirty.join(", ")}</span>
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
            <button className="chip" onClick={() => setDraft(settings)}>
              Revert
            </button>
            <Button
              disabled={saving || nameEmpty}
              onClick={async () => {
                setSaving(true);
                try {
                  // Only the editable fields are written back; the rest of the draft is display state.
                  await save({
                    providerName: draft.providerName.trim(),
                    bridgeUrl: draft.bridgeUrl,
                    runnerPath: draft.runnerPath,
                  });
                  setSavedAt(Date.now());
                } finally {
                  setSaving(false);
                }
              }}
              style={{ padding: "9px 18px", fontSize: 13 }}
            >
              {saving ? "saving…" : "Save changes"}
            </Button>
          </div>
        </div>
      )}
      {savedAt !== null && dirty.length === 0 && <span style={{ fontSize: 13, color: "var(--viz-good)" }}>Saved.</span>}
    </div>
  );
}

function Group({ icon, title, description, children }: { icon: React.ReactNode; title: string; description: string; children: React.ReactNode }) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9, color: "var(--muted)" }}>
        {icon}
        <h2 style={{ margin: 0, fontSize: 11.5, letterSpacing: "0.09em", textTransform: "uppercase", fontWeight: 400 }}>{title}</h2>
      </div>
      <p style={{ margin: 0, color: "var(--muted)", fontSize: 13, lineHeight: 1.65, maxWidth: "76ch" }}>{description}</p>
      <Card padding={18}>
        <div style={{ display: "grid", gap: 16 }}>{children}</div>
      </Card>
    </section>
  );
}

function Field({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      <span style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
        <span style={{ fontSize: 11.5, letterSpacing: "0.09em", textTransform: "uppercase", color: "var(--muted)" }}>{label}</span>
        {hint && <span style={{ fontSize: 12, color: "var(--muted)" }}>{hint}</span>}
      </span>
      {children}
    </label>
  );
}

/** A value the app decided, not the user: shown plainly, copyable, never an input. */
function ReadOnly({ label, value, empty, hint }: { label: string; value: string | null; empty: string; hint?: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      <span style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
        <span style={{ fontSize: 11.5, letterSpacing: "0.09em", textTransform: "uppercase", color: "var(--muted)" }}>{label}</span>
        {hint && <span style={{ fontSize: 12, color: "var(--muted)" }}>{hint}</span>}
      </span>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          minHeight: 38,
          padding: "8px 11px",
          borderRadius: "var(--r-sm)",
          border: "1px dashed var(--line)",
          background: "var(--surface-sunken)",
          color: "var(--muted-bright)",
          fontSize: 13.5,
        }}
      >
        {value ? <Copyable value={value} /> : <span style={{ color: "var(--placeholder)" }}>{empty}</span>}
      </div>
    </div>
  );
}

function changedKeys(saved: SettingsType, draft: SettingsType): string[] {
  return (Object.keys(EDITABLE) as (keyof SettingsType)[])
    .filter(key => JSON.stringify(saved[key]) !== JSON.stringify(draft[key]))
    .map(key => EDITABLE[key]!);
}
