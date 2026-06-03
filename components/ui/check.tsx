import type { ReactNode } from "react";
import { Icon } from "./icon";

/* ============================================================
   Check — a single green-check list line (site instructions,
   benefit lists). Verification-friendly.
   ============================================================ */

export interface CheckProps {
  children?: ReactNode;
}

export function Check({ children }: CheckProps) {
  return (
    <span
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        fontSize: 13,
        color: "var(--fg-2)",
      }}
    >
      <Icon name="check-circle-2" size={16} color="var(--success)" />
      {children}
    </span>
  );
}
