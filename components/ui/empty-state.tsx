"use client";

import type { ReactNode } from "react";
import { Icon } from "./icon";

/* ============================================================
   EmptyState — centered teal-tinted icon tile + title + sub +
   optional action. Reuses the look of the screen Placeholder.
   ============================================================ */

export interface EmptyStateProps {
  icon?: string;
  title: ReactNode;
  sub?: ReactNode;
  action?: ReactNode;
}

export function EmptyState({ icon = "inbox", title, sub, action }: EmptyStateProps) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        textAlign: "center",
        padding: "48px 24px",
      }}
    >
      <span
        style={{
          width: 56,
          height: 56,
          borderRadius: 14,
          background: "var(--fs-teal-tint)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon name={icon} size={26} color="var(--fs-teal)" />
      </span>
      <div style={{ fontSize: 16, fontWeight: 700, color: "var(--fg-1)" }}>{title}</div>
      {sub && (
        <div style={{ fontSize: 13.5, color: "var(--fg-3)", maxWidth: 380 }}>{sub}</div>
      )}
      {action && <div style={{ marginTop: 4 }}>{action}</div>}
    </div>
  );
}
