"use client";

import type { ReactNode } from "react";

/* ============================================================
   Switch — accessible toggle (role="switch", aria-checked).
   Teal track when on; soft neutral track when off. Optional label.
   ============================================================ */

export interface SwitchProps {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: ReactNode;
}

export function Switch({ checked, onChange, label }: SwitchProps) {
  const toggle = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      style={{
        position: "relative",
        width: 40,
        height: 22,
        flexShrink: 0,
        borderRadius: 999,
        border: "1px solid transparent",
        padding: 0,
        cursor: "pointer",
        background: checked ? "var(--fs-teal)" : "var(--border-2)",
        transition: ".18s",
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 2,
          left: checked ? 20 : 2,
          width: 16,
          height: 16,
          borderRadius: 999,
          background: "#fff",
          boxShadow: "var(--shadow-xs)",
          transition: ".18s",
        }}
      />
    </button>
  );

  if (!label) return toggle;

  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
      {toggle}
      <span style={{ fontSize: 14, fontWeight: 500, color: "var(--fg-1)" }}>{label}</span>
    </label>
  );
}
