"use client";

import { useState } from "react";
import { Icon } from "@/components/ui/icon";

/* ============================================================
   Topbar — 64px white bar: search, date pill, notifications,
   help, and a company switcher dropdown.
   ============================================================ */

export interface TopbarProps {
  dateLabel?: string;
  companies?: string[];
}

export function Topbar({ dateLabel, companies }: TopbarProps) {
  const list = companies || [
    "BrightBuild Co.",
    "BrightLife Care",
    "BrightGuard Co.",
    "Brightside Constructions",
  ];
  const [company, setCompany] = useState(list[0]);
  const [open, setOpen] = useState(false);

  return (
    <header
      style={{
        height: 64,
        flexShrink: 0,
        background: "var(--surface)",
        borderBottom: "1px solid var(--border)",
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "0 24px",
      }}
    >
      <div
        style={{
          flex: 1,
          maxWidth: 420,
          minWidth: 0,
          display: "flex",
          alignItems: "center",
          gap: 9,
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          padding: "9px 13px",
        }}
      >
        <Icon name="search" size={16} color="var(--fg-4)" />
        <span
          style={{
            color: "var(--fg-4)",
            fontSize: 14,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          Search people, jobs, sites…
        </span>
      </div>
      <div style={{ flex: 1 }} />
      {dateLabel && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 13,
            fontWeight: 600,
            color: "var(--fg-2)",
            border: "1px solid var(--border)",
            borderRadius: 9,
            padding: "8px 12px",
          }}
        >
          <Icon name="calendar" size={15} color="var(--fg-3)" />
          {dateLabel}
        </div>
      )}
      <button
        style={{
          border: 0,
          background: "transparent",
          cursor: "pointer",
          position: "relative",
          display: "flex",
        }}
        aria-label="Notifications"
      >
        <Icon name="bell" size={19} color="var(--fg-3)" />
        <span
          style={{
            position: "absolute",
            top: -2,
            right: -2,
            width: 7,
            height: 7,
            borderRadius: 999,
            background: "var(--danger)",
            boxShadow: "0 0 0 2px #fff",
          }}
        />
      </button>
      <Icon name="circle-help" size={19} color="var(--fg-3)" />
      <div style={{ position: "relative" }}>
        <button
          onClick={() => setOpen((o) => !o)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            border: "1px solid var(--border)",
            borderRadius: 9,
            padding: "7px 11px",
            background: "#fff",
            cursor: "pointer",
            font: "inherit",
          }}
        >
          <Icon name="building-2" size={16} color="var(--fg-3)" />
          <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--fg-1)" }}>{company}</span>
          <Icon name="chevron-down" size={15} color="var(--fg-4)" />
        </button>
        {open && (
          <div
            style={{
              position: "absolute",
              top: "110%",
              right: 0,
              background: "#fff",
              border: "1px solid var(--border)",
              borderRadius: 12,
              boxShadow: "var(--shadow-lg)",
              padding: 6,
              minWidth: 220,
              zIndex: 30,
            }}
          >
            {list.map((c) => (
              <button
                key={c}
                onClick={() => {
                  setCompany(c);
                  setOpen(false);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  width: "100%",
                  textAlign: "left",
                  border: 0,
                  background: c === company ? "var(--fs-teal-tint)" : "transparent",
                  cursor: "pointer",
                  padding: "9px 11px",
                  borderRadius: 8,
                  font: "inherit",
                  fontSize: 13.5,
                  fontWeight: 500,
                  color: c === company ? "var(--fs-teal-700)" : "var(--fg-2)",
                }}
              >
                <Icon name="building-2" size={15} />
                {c}
                {c === company && (
                  <span style={{ marginLeft: "auto" }}>
                    <Icon name="check" size={15} />
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </header>
  );
}
