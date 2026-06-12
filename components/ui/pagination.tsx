"use client";

import type { CSSProperties } from "react";
import { Icon } from "./icon";

/* ============================================================
   Pagination — numbered pages (active = teal fill, white text);
   prev/next chevron buttons disabled at the bounds. Page count
   derives from total / pageSize.
   ============================================================ */

export interface PaginationProps {
  page: number;
  total: number;
  pageSize: number;
  onChange: (p: number) => void;
}

const CELL: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minWidth: 34,
  height: 34,
  padding: "0 8px",
  borderRadius: 9,
  border: "1px solid var(--border)",
  background: "#fff",
  font: "inherit",
  fontSize: 13.5,
  fontWeight: 600,
  color: "var(--fg-2)",
  cursor: "pointer",
};

export function Pagination({ page, total, pageSize, onChange }: PaginationProps) {
  const count = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
  const current = Math.min(Math.max(1, page), count);
  const pages = Array.from({ length: count }, (_, i) => i + 1);

  const arrow = (dir: "left" | "right", disabled: boolean, target: number) => (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(target)}
      aria-label={dir === "left" ? "Previous page" : "Next page"}
      style={{
        ...CELL,
        color: disabled ? "var(--fg-4)" : "var(--fg-2)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.55 : 1,
      }}
    >
      <Icon name={dir === "left" ? "chevron-left" : "chevron-right"} size={16} />
    </button>
  );

  return (
    <nav
      aria-label="Pagination"
      style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
    >
      {arrow("left", current <= 1, current - 1)}
      {pages.map((p) => {
        const active = p === current;
        return (
          <button
            key={p}
            type="button"
            onClick={() => onChange(p)}
            aria-current={active ? "page" : undefined}
            className="fs-tnum"
            style={{
              ...CELL,
              background: active ? "var(--fs-teal)" : "#fff",
              color: active ? "#fff" : "var(--fg-2)",
              borderColor: active ? "var(--fs-teal)" : "var(--border)",
            }}
          >
            {p}
          </button>
        );
      })}
      {arrow("right", current >= count, current + 1)}
    </nav>
  );
}
