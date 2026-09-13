import { useEffect, useState, type ReactNode } from "react";
import { IconCheck, IconCopy } from "./icons";

/**
 * Account ids, topic ids and wallet addresses exist to be pasted somewhere else, so every one of
 * them in this app is one click away from the clipboard.
 */
export function Copyable({ value, children, title }: { value: string; children?: ReactNode; title?: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1400);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <button
      className="copyable tabular"
      title={title ?? `Copy ${value}`}
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => setCopied(true));
      }}
      style={{ fontSize: "inherit", flexShrink: 0 }}
    >
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{children ?? value}</span>
      <span className="copy-glyph" style={{ opacity: copied ? 1 : undefined, color: copied ? "var(--viz-good)" : undefined }}>
        {copied ? <IconCheck size={12} /> : <IconCopy size={12} />}
      </span>
    </button>
  );
}
