"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/ui/icon";
import { Avatar } from "@/components/ui/avatar";
import { Menu } from "@/components/ui";
import { useEffect, useState } from "react";
import { NAV } from "./nav";

/* ============================================================
   Sidebar — fixed 232px deep-navy nav. Single active item
   (teal fill, white text). idara module shows the idara mark.
   ============================================================ */

export function Sidebar() {
  /* Who is signed in, asked of the server rather than assumed.

     This said "Emma Taylor" for as long as the console had no sign-in, which
     was honest then — it named the constant the audit chain was going to
     record whoever was looking. Now that a session exists, a hardcoded name
     would be the opposite: a screen asserting an identity nobody proved,
     while the chain records the one that did. */
  const [me, setMe] = useState<{ name: string; role: string } | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const r = await fetch("/api/auth/session");
        const b = await r.json();
        if (b.signedIn && b.kind === "operator") {
          setMe(b.operator);
          return;
        }
        /* Anybody else is sent to the door.

           Presentation, not a gate — every console route resolves the session
           itself and refuses, and this changes none of that. What it fixes is
           that the middleware can only see whether a cookie EXISTS, and
           cookies are not scoped by port or by app: a worker signed in on
           their phone satisfies it and lands in a console shell where nothing
           loads and no name appears. Refusing to render it is kinder than
           letting them sit in a room where every drawer is locked. */
        window.location.href = "/console-sign-in";
      } catch {
        /* offline: leave it blank rather than claim somebody is here, and do
           not throw a signed-in operator out over one failed request */
      }
    })();
  }, []);

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
          src="/assets/covers-icon-t.png"
          alt="Covers"
          style={{ width: 24, height: 24, objectFit: "contain" }}
        />
        covers
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
          marginTop: 8,
          borderTop: "1px solid rgba(255,255,255,.08)",
          paddingTop: 8,
        }}
      >
        <Menu
          align="left"
          items={[
            { label: "View profile", icon: "user", href: "/people" },
            { label: "Settings", icon: "settings", href: "/settings" },
            {
              label: "Sign out",
              icon: "log-out",
              tone: "danger",
              onClick: () => {
                // ends the session on the server, not just the impression of one
                void fetch("/api/auth/session", { method: "DELETE" }).finally(() => {
                  window.location.href = "/console-sign-in";
                });
              },
            },
          ]}
        >
          <button
            type="button"
            aria-label="Account menu"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              width: 208,
              padding: "10px",
              border: 0,
              background: "transparent",
              cursor: "pointer",
              borderRadius: 9,
              textAlign: "left",
              font: "inherit",
            }}
          >
            <Avatar name={me?.name ?? ""} size={34} />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", color: "#fff", fontSize: 13.5, fontWeight: 600 }}>
                {me?.name ?? "…"}
              </span>
              <span style={{ display: "block", color: "#7C8B98", fontSize: 11.5 }}>
                {me?.role ?? ""}
              </span>
            </span>
            <Icon name="chevron-down" size={15} color="#7C8B98" />
          </button>
        </Menu>
      </div>
    </aside>
  );
}
