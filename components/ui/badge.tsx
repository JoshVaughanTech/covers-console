import type { CSSProperties, ReactNode } from "react";
import { Icon } from "./icon";
import { STATUS, type Tone } from "@/lib/status";

/* ============================================================
   Badge / status pill — tinted bg + optional dot or icon.
   ============================================================ */

export interface BadgeProps {
  tone?: Tone;
  dot?: boolean;
  icon?: string;
  children?: ReactNode;
  style?: CSSProperties;
}

export function Badge({ tone = "neutral", dot, icon, children, style }: BadgeProps) {
  const [bg, fg, dc] = STATUS[tone] ?? STATUS.neutral;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        background: bg,
        color: fg,
        fontSize: 12,
        fontWeight: 600,
        padding: "4px 10px",
        borderRadius: 999,
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {dot && (
        <span
          style={{ width: 6, height: 6, borderRadius: 999, background: dc }}
        />
      )}
      {icon && <Icon name={icon} size={13} stroke={2.2} />}
      {children}
    </span>
  );
}
