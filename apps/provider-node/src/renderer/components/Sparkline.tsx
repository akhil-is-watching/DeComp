/** 12-ish point trend line for a stat tile. De-emphasised, with the current point in the accent. */
export function Sparkline({ values, width = 96, height = 26 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) return <div style={{ width, height }} />;

  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const step = width / (values.length - 1);
  const y = (value: number) => height - 3 - ((value - min) / span) * (height - 6);
  const points = values.map((value, i) => [i * step, y(value)] as const);
  const line = points.map(([px, py], i) => `${i === 0 ? "M" : "L"}${px.toFixed(1)} ${py.toFixed(1)}`).join(" ");
  const area = `${line} L${width} ${height} L0 ${height} Z`;
  const last = points[points.length - 1]!;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden style={{ display: "block", overflow: "visible" }}>
      <path d={area} fill="var(--viz-series-1-wash)" />
      <path d={line} fill="none" stroke="var(--viz-series-1)" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r={2.6} fill="var(--viz-series-1)" stroke="var(--surface-1)" strokeWidth={2} />
    </svg>
  );
}
