import type { CSSProperties, ReactNode } from "react";

/* ============================================================
   Card — white surface, hairline border + soft navy-tinted
   shadow, 16px radius, generous padding. No left-border accents.
   ============================================================ */

export interface CardProps {
  children?: ReactNode;
  style?: CSSProperties;
  pad?: number;
  onClick?: () => void;
}

export function Card({ children, style, pad = 20, onClick }: CardProps) {
  return (
    <div
      onClick={onClick}
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 16,
        boxShadow: "var(--shadow-card)",
        padding: pad,
        ...style,
      }}
    >
      {children}
    </div>
  );
}
