"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/icon";
import { Menu, SearchInput, useToast } from "@/components/ui";
import {
  useCompany,
  useNotifications,
  useGlobalSearch,
  type SearchResultType,
} from "@/lib/store/shell";
import { STATUS } from "@/lib/status";

/* ============================================================
   Topbar — 64px white bar: search, date pill, notifications,
   help, and a company switcher dropdown.
   ============================================================ */

export interface TopbarProps {
  dateLabel?: string;
}

const RESULT_ICON: Record<SearchResultType, string> = {
  person: "user",
  job: "briefcase",
  site: "map-pin",
};

export function Topbar({ dateLabel }: TopbarProps) {
  const router = useRouter();
  const toast = useToast();
  const { company, setCompany, companies } = useCompany();
  const { items, unread, markAllRead } = useNotifications();

  /* ---- global search ---- */
  const [query, setQuery] = useState("");
  const results = useGlobalSearch(query);
  const searchRef = useRef<HTMLDivElement>(null);

  /* ---- notifications dropdown ---- */
  const [bellOpen, setBellOpen] = useState(false);
  const bellRef = useRef<HTMLDivElement>(null);

  /* ---- company switcher ---- */
  const [companyOpen, setCompanyOpen] = useState(false);
  const companyRef = useRef<HTMLDivElement>(null);

  /* close popovers on outside click + Esc */
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (searchRef.current && !searchRef.current.contains(t)) setQuery("");
      if (bellRef.current && !bellRef.current.contains(t)) setBellOpen(false);
      if (companyRef.current && !companyRef.current.contains(t)) setCompanyOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setQuery("");
        setBellOpen(false);
        setCompanyOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const go = (href: string) => {
    router.push(href);
    setQuery("");
  };

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
      {/* search */}
      <div ref={searchRef} style={{ position: "relative", flex: 1, maxWidth: 420, minWidth: 0 }}>
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Search people, jobs, sites…"
        />
        {query.trim() && (
          <div
            style={{
              position: "absolute",
              top: "calc(100% + 6px)",
              left: 0,
              right: 0,
              background: "#fff",
              border: "1px solid var(--border)",
              borderRadius: 12,
              boxShadow: "var(--shadow-lg)",
              padding: 6,
              zIndex: 40,
              maxHeight: 360,
              overflowY: "auto",
            }}
          >
            {results.length === 0 ? (
              <div
                style={{
                  padding: "12px 11px",
                  fontSize: 13.5,
                  color: "var(--fg-3)",
                }}
              >
                No results for &quot;{query.trim()}&quot;
              </div>
            ) : (
              results.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => go(r.href)}
                  className="hov-row"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 11,
                    width: "100%",
                    textAlign: "left",
                    border: 0,
                    background: "transparent",
                    cursor: "pointer",
                    padding: "9px 11px",
                    borderRadius: 8,
                    font: "inherit",
                  }}
                >
                  <span
                    style={{
                      width: 30,
                      height: 30,
                      flexShrink: 0,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      borderRadius: 8,
                      background: "var(--fs-teal-tint)",
                    }}
                  >
                    <Icon name={RESULT_ICON[r.type]} size={15} color="var(--fs-teal-700)" />
                  </span>
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span
                      style={{
                        display: "block",
                        fontSize: 13.5,
                        fontWeight: 600,
                        color: "var(--fg-1)",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {r.title}
                    </span>
                    <span
                      style={{
                        display: "block",
                        fontSize: 12,
                        color: "var(--fg-3)",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {r.sub}
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>
        )}
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

      {/* notifications */}
      <div ref={bellRef} style={{ position: "relative", display: "flex" }}>
        <button
          type="button"
          onClick={() => setBellOpen((o) => !o)}
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
          {unread > 0 && (
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
          )}
        </button>
        {bellOpen && (
          <div
            style={{
              position: "absolute",
              top: "calc(100% + 10px)",
              right: 0,
              background: "#fff",
              border: "1px solid var(--border)",
              borderRadius: 12,
              boxShadow: "var(--shadow-lg)",
              width: 340,
              zIndex: 40,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "12px 14px",
                borderBottom: "1px solid var(--border)",
              }}
            >
              <span style={{ fontSize: 13.5, fontWeight: 700, color: "var(--fg-1)" }}>
                Notifications
              </span>
              <button
                type="button"
                onClick={() => markAllRead()}
                disabled={unread === 0}
                style={{
                  border: 0,
                  background: "transparent",
                  cursor: unread === 0 ? "default" : "pointer",
                  font: "inherit",
                  fontSize: 12.5,
                  fontWeight: 600,
                  color: unread === 0 ? "var(--fg-4)" : "var(--fs-teal-700)",
                  padding: 0,
                }}
              >
                Mark all read
              </button>
            </div>
            <div style={{ maxHeight: 380, overflowY: "auto", padding: 6 }}>
              {items.map((n) => {
                const [bg, fg] = STATUS[n.tone] ?? STATUS.neutral;
                return (
                  <div
                    key={n.id}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 11,
                      padding: "10px 9px",
                      borderRadius: 9,
                      background: n.read ? "transparent" : "var(--fs-teal-tint-2)",
                    }}
                  >
                    <span
                      style={{
                        width: 30,
                        height: 30,
                        flexShrink: 0,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        borderRadius: 8,
                        background: bg,
                      }}
                    >
                      <Icon name={n.icon} size={15} color={fg} />
                    </span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: n.read ? 500 : 600,
                          color: "var(--fg-1)",
                          lineHeight: 1.35,
                        }}
                      >
                        {n.title}
                      </div>
                      <div style={{ fontSize: 11.5, color: "var(--fg-3)", marginTop: 2 }}>
                        {n.meta} · {n.time}
                      </div>
                    </div>
                    {!n.read && (
                      <span
                        style={{
                          width: 7,
                          height: 7,
                          flexShrink: 0,
                          marginTop: 5,
                          borderRadius: 999,
                          background: "var(--fs-teal)",
                        }}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* help */}
      <Menu
        align="right"
        items={[
          {
            label: "Documentation",
            icon: "book-open",
            onClick: () => toast("Opening documentation…", { tone: "info", icon: "book-open" }),
          },
          {
            label: "Keyboard shortcuts",
            icon: "keyboard",
            onClick: () => toast("Keyboard shortcuts", { tone: "info", icon: "keyboard" }),
          },
          {
            label: "Contact support",
            icon: "life-buoy",
            onClick: () => toast("Support request started", { tone: "teal", icon: "life-buoy" }),
          },
        ]}
      >
        <span
          aria-label="Help"
          style={{ display: "inline-flex", cursor: "pointer" }}
        >
          <Icon name="circle-help" size={19} color="var(--fg-3)" />
        </span>
      </Menu>

      {/* company switcher */}
      <div ref={companyRef} style={{ position: "relative" }}>
        <button
          type="button"
          onClick={() => setCompanyOpen((o) => !o)}
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
        {companyOpen && (
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
            {companies.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => {
                  setCompany(c);
                  setCompanyOpen(false);
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
