"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

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
  { href: "/m/earnings", label: "Earnings" },
  { href: "/m/pack", label: "Pack" },
  { href: "/m/profile", label: "Profile" },
] as const;

/* What a venue sign-in gets instead — not in addition.

   The six above are worker screens: every one reads b.worker from the session
   and, finding none, renders the staff sign-in picker. So an operator shown
   those tabs gets six dead ends, and the failure is worse than a wasted tap.
   The picker invites them to sign in as a WORKER, which replaces the operator
   session they are holding — after which Post disappears, and nothing
   anywhere explains why.

   Operators and workers are separate populations on purpose
   (lib/auth/operators.ts: "an operator is not a worker with a flag"), and
   Sophie Nguyen exists in both rosters. A nav that mixes the two invites
   somebody to swap identity by accident.

   Two entries rather than one, because a nav with a single item is a nav that
   has stopped being one: the console is where the rest of an operator's work
   is, and this says so rather than leaving the phone a cul-de-sac.

   Asked of the server rather than inferred from anything the device holds. A
   tab drawn from a guess would be a tab that 401s on arrival, and the screen
   behind it refuses independently regardless: this decides what to DRAW, and
   nothing more. */
const OPERATOR_TABS = [
  { href: "/m/post", label: "Post" },
  { href: "/overview", label: "Console" },
] as const;

export type MobileTab = (typeof TABS)[number]["href"] | (typeof OPERATOR_TABS)[number]["href"];

export interface Tab {
  href: string;
  label: string;
}

/**
 * Which tabs a session of this kind gets.
 *
 * Pulled out of the component so it can be held to the property that matters
 * without rendering anything: the two sets do not overlap. A worker offered
 * Post gets a 401; an operator offered a worker tab gets the staff sign-in
 * picker, which would replace the session they are holding.
 *
 * Signed out falls to the worker tabs, because that is who the phone app is
 * for — the venue screens are the exception, not the default.
 */
export function tabsFor(kind: "worker" | "operator" | null): readonly Tab[] {
  return kind === "operator" ? OPERATOR_TABS : TABS;
}

/* Sized to content, not to an equal share. `flex: 1` gives every tab the same
   width whatever its label, so the longest name is always the first to run out
   of room — and at 320px "Earnings" filled its box to the pixel. The tab whose
   name is hardest to guess from four letters is the worst one to truncate.

   And it wraps, which the five-tab version did not need to. Earnings and Pack
   arrived on separate branches, so neither author was looking at six: six
   content-sized tabs do not fit one row on a 320px phone, and `nowrap` without
   `flexWrap` resolves that by overflowing the viewport rather than by
   shrinking. Two readable rows beat one row that runs off the screen. */
const style = (on: boolean): React.CSSProperties => ({
  flex: "1 1 auto", minWidth: 88, textAlign: "center",
  padding: "8px 4px", borderRadius: 10, fontSize: 13, fontWeight: 600,
  textDecoration: "none", whiteSpace: "nowrap",
  border: `1px solid ${on ? "var(--accent)" : "var(--border)"}`,
  background: on ? "var(--accent-bg, var(--bg-2))" : "#fff",
  color: on ? "var(--accent-fg, var(--fg-1))" : "var(--fg-3)",
});

export function MobileNav({ current }: { current: MobileTab }) {
  /* Undefined until the answer arrives, so the Post tab appears rather than
     flickering away — a tab that shows and then vanishes reads as a bug, and
     the wrong direction to be wrong in is offering something and taking it
     back. */
  const [isOperator, setIsOperator] = useState<boolean | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const r = await fetch("/api/auth/session");
        const b = (await r.json()) as { kind?: string };
        if (live) setIsOperator(b.kind === "operator");
      } catch {
        if (live) setIsOperator(false);
      }
    })();
    return () => { live = false; };
  }, []);

  /* Replaced, not appended. Signed out falls to the worker tabs because that
     is who the phone app is for; the venue screens are the exception. */
  const tabs = tabsFor(isOperator ? "operator" : "worker");

  return (
    <nav style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
      {tabs.map((t) =>
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
