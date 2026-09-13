import type { ReactNode } from "react";

export type Segment<T extends string> = { id: T; label: string; icon?: ReactNode };

/** The macOS toolbar segmented control — the app's primary navigation. */
export function Segmented<T extends string>({
  segments,
  value,
  onChange,
  ariaLabel,
}: {
  segments: readonly Segment<T>[];
  value: T;
  onChange: (id: T) => void;
  ariaLabel: string;
}) {
  return (
    <div className="segmented no-drag" role="tablist" aria-label={ariaLabel}>
      {segments.map(segment => (
        <button
          key={segment.id}
          role="tab"
          aria-selected={value === segment.id}
          className="segment"
          onClick={() => onChange(segment.id)}
        >
          {segment.icon}
          {segment.label}
        </button>
      ))}
    </div>
  );
}
