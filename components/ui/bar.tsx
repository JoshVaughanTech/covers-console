/* ============================================================
   Bar — thin progress bar on a sunken track.
   ============================================================ */

export interface BarProps {
  value: number;
  color?: string;
  height?: number;
}

export function Bar({ value, color = "var(--success)", height = 6 }: BarProps) {
  return (
    <div
      style={{
        height,
        background: "var(--bg-2)",
        borderRadius: 999,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          width: `${value}%`,
          height: "100%",
          background: color,
          borderRadius: 999,
          transition: "width .8s ease",
        }}
      />
    </div>
  );
}
