"use client";

/* ============================================================
   Tabs — segmented pill control (matches the Attendance filter).
   Outer track bg var(--bg-2); active pill white + soft shadow.
   ============================================================ */

export interface TabsProps {
  tabs: string[];
  value: string;
  onChange: (v: string) => void;
}

export function Tabs({ tabs, value, onChange }: TabsProps) {
  return (
    <div
      role="tablist"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        background: "var(--bg-2)",
        borderRadius: 9,
        padding: 3,
      }}
    >
      {tabs.map((t) => {
        const active = t === value;
        return (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t)}
            style={{
              border: 0,
              cursor: "pointer",
              font: "inherit",
              fontSize: 13,
              fontWeight: 600,
              padding: "6px 13px",
              borderRadius: 7,
              whiteSpace: "nowrap",
              transition: ".15s",
              background: active ? "#fff" : "transparent",
              color: active ? "var(--fg-1)" : "var(--fg-3)",
              boxShadow: active ? "var(--shadow-xs)" : "none",
            }}
          >
            {t}
          </button>
        );
      })}
    </div>
  );
}
