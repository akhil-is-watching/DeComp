/**
 * Column chart for one series over time. One series by design: the two things this app measures
 * in money (HBAR and a token) have different units and can't share an axis, so they get their own
 * charts rather than a second colour on this one.
 *
 * Marks follow the house spec — bars capped at 24px with a 4px rounded cap and a square foot on
 * the baseline, hairline solid gridlines, no label on every column. Every value is also reachable
 * without hovering, through the table view.
 */
import { useState } from "react";
import { IconTable } from "./icons";

export type BarDatum = { key: string; label: string; value: number; caption?: string };

const PLOT_H = 132;
const AXIS_H = 22;
const GUTTER = 52;

export function BarChart({
  data,
  formatValue,
  unit,
  tableHeaders = ["Day", "Amount"],
}: {
  data: BarDatum[];
  formatValue: (value: number) => string;
  unit?: string;
  tableHeaders?: [string, string];
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);

  const max = niceCeiling(Math.max(...data.map(d => d.value), 0));
  const ticks = [max, max / 2, 0];
  // Every tick at the same precision — "10.0 / 5.0 / 0.000" reads as three different scales.
  const tick = (value: number) => value.toFixed(max >= 10 ? 1 : max >= 1 ? 2 : 3);
  // A share of the mark's own slot, capped at 24px; the leftover slot is the air between bars.
  const BAR_WIDTH = "58%";

  if (asTable) {
    return (
      <Framed onToggle={() => setAsTable(false)} active>
        <div className="scroll-area" style={{ maxHeight: PLOT_H + AXIS_H + 8 }}>
          <table className="tabular" style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr>
                {tableHeaders.map(header => (
                  <th
                    key={header}
                    style={{
                      textAlign: header === tableHeaders[0] ? "left" : "right",
                      padding: "5px 0",
                      color: "var(--muted)",
                      fontWeight: 400,
                      fontSize: 11.5,
                      letterSpacing: "0.1em",
                      textTransform: "uppercase",
                      borderBottom: "1px solid var(--line)",
                      position: "sticky",
                      top: 0,
                      background: "var(--surface-1)",
                    }}
                  >
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map(datum => (
                <tr key={datum.key}>
                  <td style={{ padding: "5px 0", color: "var(--muted-bright)" }}>{datum.label}</td>
                  <td style={{ padding: "5px 0", textAlign: "right", color: datum.value > 0 ? "var(--text)" : "var(--muted)" }}>
                    {formatValue(datum.value)}
                    {unit ? ` ${unit}` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Framed>
    );
  }

  return (
    <Framed onToggle={() => setAsTable(true)}>
      <div style={{ position: "relative", height: PLOT_H + AXIS_H }} onMouseLeave={() => setHovered(null)}>
        {/* y-axis ticks, rounded to clean numbers; they carry the values no column is labelled with */}
        {ticks.map((value, i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: (i * PLOT_H) / (ticks.length - 1),
              display: "flex",
              alignItems: "center",
              gap: 8,
              pointerEvents: "none",
            }}
          >
            <span className="tabular" style={{ width: GUTTER - 10, textAlign: "right", fontSize: 11, color: "var(--muted)", lineHeight: 1 }}>
              {tick(value)}
            </span>
            <div style={{ flex: 1, height: 1, background: "var(--viz-grid)" }} />
          </div>
        ))}

        <div className="viz-plot" style={{ position: "absolute", inset: `0 0 ${AXIS_H}px ${GUTTER}px`, display: "flex", alignItems: "flex-end" }}>
          {data.map((datum, i) => {
            const height = max > 0 ? (datum.value / max) * PLOT_H : 0;
            const active = hovered === i;
            return (
              <div
                key={datum.key}
                onMouseEnter={() => setHovered(i)}
                style={{ flex: 1, height: "100%", display: "flex", alignItems: "flex-end", justifyContent: "center", position: "relative" }}
              >
                <div
                  className="viz-bar"
                  data-active={active}
                  style={{
                    width: BAR_WIDTH,
                    maxWidth: 24,
                    minWidth: 3,
                    height: Math.max(height, datum.value > 0 ? 2 : 0),
                    minHeight: datum.value > 0 ? 2 : 0,
                    background: "var(--viz-series-1)",
                    borderRadius: "4px 4px 0 0",
                    // Same reasoning as .rise: no fill mode, so a bar is never left collapsed.
                    animation: "decomp-grow 420ms var(--ease)",
                  }}
                />
                {/* an empty day still needs a foot on the baseline, or the gap reads as missing data */}
                {datum.value === 0 && (
                  <div style={{ position: "absolute", bottom: 0, width: BAR_WIDTH, maxWidth: 24, minWidth: 3, height: 2, background: "var(--viz-track)" }} />
                )}
              </div>
            );
          })}
        </div>

        {/* x-axis: labelled selectively, so ticks never collide however wide the window is */}
        <div
          style={{
            position: "absolute",
            left: GUTTER,
            right: 0,
            bottom: 0,
            height: AXIS_H,
            display: "flex",
            alignItems: "center",
            borderTop: "1px solid var(--viz-grid)",
          }}
        >
          {data.map((datum, i) => (
            <span
              key={datum.key}
              className="tabular"
              style={{
                flex: 1,
                textAlign: "center",
                fontSize: 11,
                color: hovered === i ? "var(--text)" : "var(--muted)",
                whiteSpace: "nowrap",
                overflow: "hidden",
              }}
            >
              {labelEvery(data.length, i) || hovered === i ? datum.label : ""}
            </span>
          ))}
        </div>

        {hovered !== null && data[hovered] && (
          <Tooltip
            datum={data[hovered]!}
            index={hovered}
            count={data.length}
            barHeight={max > 0 ? (data[hovered]!.value / max) * PLOT_H : 0}
            formatValue={formatValue}
            unit={unit}
          />
        )}
      </div>
    </Framed>
  );
}

/**
 * Lives inside the plot box, never above it: anchored over the hovered bar's cap and clamped to
 * the plot's own bounds, so it can't spill past the card edge (and can't be clipped by a card
 * that hides its overflow).
 */
function Tooltip({
  datum,
  index,
  count,
  barHeight,
  formatValue,
  unit,
}: {
  datum: BarDatum;
  index: number;
  count: number;
  barHeight: number;
  formatValue: (value: number) => string;
  unit?: string;
}) {
  // Roughly the rendered height; only used to decide placement, and the clamp below is the guard.
  const ESTIMATED_H = datum.caption ? 72 : 54;
  const capFromTop = PLOT_H - barHeight;
  const top = Math.min(Math.max(capFromTop - ESTIMATED_H - 8, 2), Math.max(PLOT_H - ESTIMATED_H, 2));

  // Near an edge the card pivots on that edge instead of its centre, so it stays inside the plot.
  const fraction = (index + 0.5) / count;
  const anchor = fraction < 0.2 ? "0%" : fraction > 0.8 ? "-100%" : "-50%";

  return (
    <div
      role="status"
      style={{
        position: "absolute",
        left: `calc(${GUTTER}px + (100% - ${GUTTER}px) * ${fraction})`,
        top,
        transform: `translateX(${anchor})`,
        pointerEvents: "none",
        background: "var(--surface-1)",
        border: "1px solid var(--line-strong)",
        borderRadius: 10,
        boxShadow: "var(--shadow-pop)",
        padding: "7px 11px",
        whiteSpace: "nowrap",
        zIndex: 3,
      }}
    >
      <div style={{ fontSize: 11.5, color: "var(--muted)", letterSpacing: "0.09em", textTransform: "uppercase" }}>{datum.label}</div>
      <div className="tabular" style={{ fontSize: 14, marginTop: 3 }}>
        {formatValue(datum.value)}
        {unit && <span style={{ color: "var(--muted-bright)", marginLeft: 4 }}>{unit}</span>}
      </div>
      {datum.caption && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3 }}>{datum.caption}</div>}
    </div>
  );
}

function Framed({ children, onToggle, active = false }: { children: React.ReactNode; onToggle: () => void; active?: boolean }) {
  return (
    <figure style={{ margin: 0, position: "relative" }}>
      <button
        className="icon-button"
        onClick={onToggle}
        aria-pressed={active}
        aria-label={active ? "Show chart" : "Show values as a table"}
        title={active ? "Show chart" : "Show values as a table"}
        style={{ position: "absolute", top: -40, right: 0, color: active ? "var(--accent)" : undefined }}
      >
        <IconTable size={14} />
      </button>
      {children}
    </figure>
  );
}

/** 0 / 1,000 / 2,000 rather than 0 / 1,137 / 2,274. */
function niceCeiling(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const step = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find(candidate => normalized <= candidate) ?? 10;
  return step * magnitude;
}

/** Labels thin out as columns multiply — never a dense row of overlapping dates. */
function labelEvery(count: number, index: number): boolean {
  const stride = count <= 8 ? 1 : count <= 16 ? 2 : count <= 32 ? 5 : 7;
  return index % stride === 0 || index === count - 1;
}
