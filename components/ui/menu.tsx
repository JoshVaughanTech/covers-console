"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { Icon } from "./icon";
import type { Tone } from "@/lib/status";

/* ============================================================
   Menu — children act as the trigger; clicking toggles a
   shadow-lg popover of items. Item with href renders next/link,
   otherwise a button. Closes on outside mousedown + Esc.
   ============================================================ */

export interface MenuItem {
  label: string;
  icon?: string;
  onClick?: () => void;
  href?: string;
  tone?: Tone;
}

export interface MenuProps {
  items: MenuItem[];
  align?: "left" | "right";
  children: ReactNode;
}

export function Menu({ items, align = "left", children }: MenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const itemBase = {
    display: "flex",
    alignItems: "center",
    gap: 9,
    width: "100%",
    textAlign: "left" as const,
    border: 0,
    background: "transparent",
    cursor: "pointer",
    padding: "9px 11px",
    borderRadius: 8,
    font: "inherit",
    fontSize: 13.5,
    fontWeight: 500,
    textDecoration: "none",
  };

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-flex" }}>
      <span onClick={() => setOpen((o) => !o)} style={{ display: "inline-flex", cursor: "pointer" }}>
        {children}
      </span>
      {open && (
        <div
          role="menu"
          style={{
            position: "absolute",
            top: "110%",
            ...(align === "right" ? { right: 0 } : { left: 0 }),
            background: "#fff",
            border: "1px solid var(--border)",
            borderRadius: 12,
            boxShadow: "var(--shadow-lg)",
            padding: 6,
            minWidth: 200,
            zIndex: 50,
          }}
        >
          {items.map((it, i) => {
            const color = it.tone === "danger" ? "var(--danger-fg)" : "var(--fg-2)";
            const iconColor = it.tone === "danger" ? "var(--danger-fg)" : "var(--fg-3)";
            const content = (
              <>
                {it.icon && <Icon name={it.icon} size={15} color={iconColor} />}
                {it.label}
              </>
            );
            if (it.href) {
              return (
                <Link
                  key={i}
                  href={it.href}
                  role="menuitem"
                  onClick={() => setOpen(false)}
                  style={{ ...itemBase, color }}
                >
                  {content}
                </Link>
              );
            }
            return (
              <button
                key={i}
                type="button"
                role="menuitem"
                onClick={() => {
                  it.onClick?.();
                  setOpen(false);
                }}
                style={{ ...itemBase, color }}
              >
                {content}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
