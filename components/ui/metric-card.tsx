import type { ReactNode } from "react";
import { Card } from "./card";

/* ============================================================
   MetricCard — small label, big tabular number, qualitative
   status + trend line. Children slot in between (bar/sparkline).
   ============================================================ */

export interface MetricCardProps {
  label: ReactNode;
  value: ReactNode;
  unit?: ReactNode;
  status?: ReactNode;
  statusTone?: string;
  trend?: ReactNode;
  trendTone?: string;
  children?: ReactNode;
  accent?: string;
}

export function MetricCard({
  label,
  value,
  unit,
  status,
  statusTone,
  trend,
  trendTone,
  children,
  accent,
}: MetricCardProps) {
  return (
    <Card pad={18} style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
      <div style={{ fontSize: 13, color: "var(--fg-3)", fontWeight: 600 }}>{label}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 2 }}>
        <span
          className="fs-tnum"
          style={{
            fontSize: 34,
            fontWeight: 800,
            letterSpacing: "-.02em",
            color: accent || "var(--fg-1)",
          }}
        >
          {value}
        </span>
        {unit && (
          <span style={{ fontSize: 14, color: "var(--fg-3)", fontWeight: 600 }}>{unit}</span>
        )}
      </div>
      {status && (
        <div style={{ fontSize: 13, fontWeight: 700, color: statusTone || "var(--fg-2)" }}>
          {status}
        </div>
      )}
      {children}
      {trend && (
        <div
          style={{ fontSize: 12, fontWeight: 600, color: trendTone || "var(--fg-3)", marginTop: 4 }}
        >
          {trend}
        </div>
      )}
    </Card>
  );
}
