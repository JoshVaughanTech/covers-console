"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/ui/icon";
import { Avatar } from "@/components/ui/avatar";
import { NAV } from "./nav";

/* ============================================================
   Sidebar — fixed 232px deep-navy nav. Single active item
   (teal fill, white text). idara module shows the idara mark.
   ============================================================ */

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside
      style={{
        width: 232,
        background: "var(--ink-900)",
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        padding: "18px 12px",
        height: "100%",
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 9,
          padding: "4px 10px 18px",
          color: "#fff",
          fontWeight: 800,
          fontSize: 19,
          letterSpacing: "-.01em",
        }}
      >
        <img
          src="/assets/fairshift-icon-t.png"
          alt="FairShift"
          style={{ width: 24, height: 24, objectFit: "contain" }}
        />
        FairShift
      </div>
      <nav style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1 }}>
        {NAV.map((n) => {
          const on = pathname === n.href || pathname.startsWith(n.href + "/");
          return (
            <Link
              key={n.id}
              href={n.href}
              className={"fs-nav-item" + (on ? " on" : "")}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 11,
                padding: "9px 12px",
                borderRadius: 9,
                border: 0,
                cursor: "pointer",
                textAlign: "left",
                textDecoration: "none",
                fontSize: 14,
                fontWeight: on ? 600 : 500,
                transition: ".12s",
              }}
            >
              <Icon name={n.icon} size={18} />
              <span style={{ flex: 1 }}>{n.label}</span>
              {n.idara && (
                <span style={{ width: 16, height: 16, display: "inline-flex" }}>
                  <img
                    src="/assets/idara-icon-t.png"
                    alt="idara"
                    style={{ width: 16, height: 16, objectFit: "contain", opacity: on ? 1 : 0.8 }}
                  />
                </span>
              )}
            </Link>
          );
        })}
      </nav>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px",
          marginTop: 8,
          borderTop: "1px solid rgba(255,255,255,.08)",
        }}
      >
        <Avatar name="Emma Taylor" size={34} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: "#fff", fontSize: 13.5, fontWeight: 600 }}>Emma Taylor</div>
          <div style={{ color: "#7C8B98", fontSize: 11.5 }}>Operations Manager</div>
        </div>
        <Icon name="chevron-down" size={15} color="#7C8B98" />
      </div>
    </aside>
  );
}
