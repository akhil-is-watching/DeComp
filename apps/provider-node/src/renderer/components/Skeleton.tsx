export function Skeleton({ width = "100%", height = 14, radius = 6 }: { width?: number | string; height?: number; radius?: number }) {
  return <div className="skeleton" style={{ width, height, borderRadius: radius }} />;
}

export function SkeletonStack({ rows = 3, gap = 10 }: { rows?: number; gap?: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap }}>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} width={`${100 - i * 12}%`} />
      ))}
    </div>
  );
}
