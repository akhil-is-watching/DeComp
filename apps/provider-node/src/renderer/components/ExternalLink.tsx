import type { ReactNode } from "react";
import { IconExternal } from "./icons";

/** Opens in the user's browser (main process `shell.openExternal`), never in a second Electron window. */
export function ExternalLink({ href, children, glyph = true }: { href: string; children: ReactNode; glyph?: boolean }) {
  return (
    <button
      className="link"
      title={href}
      onClick={() => {
        void window.decomp.openExternal(href);
      }}
      style={{ fontSize: "inherit", maxWidth: "100%" }}
    >
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{children}</span>
      {glyph && <IconExternal size={11} />}
    </button>
  );
}
