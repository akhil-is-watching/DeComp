import type { ButtonHTMLAttributes, ReactNode } from "react";

export function IconButton({ children, label, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode; label: string }) {
  return (
    <button {...rest} className={`icon-button no-drag${rest.className ? ` ${rest.className}` : ""}`} aria-label={label} title={label}>
      {children}
    </button>
  );
}
