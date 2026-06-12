"use client";

import { useState, type CSSProperties } from "react";
import { Icon } from "./icon";

/* ============================================================
   SearchInput — leading search icon + controlled input, with a
   clear (x) button shown when the value is non-empty.
   ============================================================ */

export interface SearchInputProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}

export function SearchInput({ value, onChange, placeholder = "Search…" }: SearchInputProps) {
  const [focus, setFocus] = useState(false);
  const wrap: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 9,
    background: "#fff",
    border: "1px solid var(--border-2)",
    borderRadius: 10,
    padding: "9px 12px",
    transition: ".15s",
    ...(focus ? { boxShadow: "var(--ring-focus)", borderColor: "var(--fs-teal)" } : {}),
  };
  return (
    <div style={wrap}>
      <Icon name="search" size={16} color="var(--fg-4)" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        style={{
          flex: 1,
          minWidth: 0,
          border: 0,
          outline: "none",
          background: "transparent",
          font: "inherit",
          fontSize: 14,
          color: "var(--fg-1)",
        }}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Clear search"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            border: 0,
            background: "transparent",
            cursor: "pointer",
            color: "var(--fg-4)",
            padding: 0,
          }}
        >
          <Icon name="x" size={15} />
        </button>
      )}
    </div>
  );
}
