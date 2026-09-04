"use client";

import Link from "next/link";

/* ============================================================
   The phone's tabs, defined once.

   They were defined twice — an mTab() in the breaks screen and an
   identical tabStyle() in the shifts screen, each with its own
   hand-written list of the other pages. Two copies of "which
   screens exist" is a third screen that appears in one nav and not
   the other, and the person who cannot find it has no way to tell a
   missing feature from a missing link.

   So the list lives here and the pages say only which one they are.
   ============================================================ */

const TABS = [
  { href: "/m", label: "Breaks" },
  { href: "/m/shifts", label: "Find" },
  { href: "/m/mine", label: "Mine" },
  { href: "/m/profile", label: "Profile" },
] as const;

export type MobileTab = (typeof TABS)[number]["href"];

const style = (on: boolean): React.CSSProperties => ({
  flex: 1, textAlign: "center", padding: "8px 0", borderRadius: 10, fontSize: 13, fontWeight: 600,
  textDecoration: "none",
  border: `1px solid ${on ? "var(--accent)" : "var(--border)"}`,
  background: on ? "var(--accent-bg, var(--bg-2))" : "#fff",
  color: on ? "var(--accent-fg, var(--fg-1))" : "var(--fg-3)",
});

export function MobileNav({ current }: { current: MobileTab }) {
  return (
    <nav style={{ display: "flex", gap: 8, marginBottom: 14 }}>
      {TABS.map((t) =>
        t.href === current ? (
          // the current tab is not a link: tapping where you already are is a
          // dead end that costs a page load to discover
          <span key={t.href} style={style(true)}>
            {t.label}
          </span>
        ) : (
          <Link key={t.href} href={t.href} style={style(false)}>
            {t.label}
          </Link>
        ),
      )}
    </nav>
  );
}
