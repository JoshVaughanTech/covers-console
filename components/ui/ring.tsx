import type { ReactNode } from "react";

/* ============================================================
   Ring — donut progress ring with optional centered label/sub.
   Animates the stroke in on mount.
   ============================================================ */

export interface RingProps {
  value?: number;
  size?: number;
  stroke?: number;
  color?: string;
  track?: string;
  label?: ReactNode;
  sub?: ReactNode;
}

export function Ring({
  value = 80,
  size = 88,
  stroke = 9,
  color = "var(--fs-teal)",
  track = "var(--bg-2)",
  label,
  sub,
}: RingProps) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const off = c * (1 - value / 100);
  return (
    <div style={{ position: "relative", width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={track}
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeDasharray={c}
          strokeDashoffset={off}
          strokeLinecap="round"
          style={{ transition: "stroke-dashoffset .9s cubic-bezier(.4,0,.2,1)" }}
        />
      </svg>
      {label != null && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            lineHeight: 1,
          }}
        >
          <span
            className="fs-tnum"
            style={{ fontSize: size * 0.26, fontWeight: 800, color: "var(--fg-1)" }}
          >
            {label}
          </span>
          {sub && (
            <span style={{ fontSize: 10, color: "var(--fg-4)", marginTop: 3 }}>
              {sub}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
