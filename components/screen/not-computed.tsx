import type { ReactNode } from "react";

/* ============================================================
   Marking a figure nothing computes.

   Most of this console is folded from the audit chain: the board,
   the credential standings, the break assessments, the payroll
   week. Some of it is not — several panels were built from the
   design kit before there was anything behind them, and they show
   plausible numbers that no code derives from anything.

   The danger is not that they are wrong. It is that they are
   INDISTINGUISHABLE from the ones that are right. A fairness score
   of 88% sits beside a break-compliance figure computed from real
   clock data under the same heading, in the same card, in the same
   typeface — and only one of them would change if the venue's week
   changed.

   That is the shape this repo keeps finding: a thing that looks
   like evidence and is not. docs/green-tests-broken-build.md has a
   whole section on it. So the fix here is the same one applied to
   the worker's profile screen, where invented stats were left out
   rather than filled in — except these are already built, so they
   are labelled instead of deleted.

   Deliberately not styled as a warning. Nothing is broken and
   nobody needs to act; it is a caption, and it should read like
   one.
   ============================================================ */

/** A chip for a card header, next to the title of an unbacked panel. */
export function NotComputed({ title }: { title?: string }) {
  return (
    <span
      title={title ?? "Illustrative — no data behind this yet"}
      style={{
        fontSize: 10.5,
        fontWeight: 700,
        letterSpacing: ".04em",
        textTransform: "uppercase",
        color: "var(--fg-4)",
        background: "var(--bg-2, #f1f3f5)",
        border: "1px solid var(--border)",
        borderRadius: 999,
        padding: "2px 7px",
        whiteSpace: "nowrap",
      }}
    >
      Illustrative
    </span>
  );
}

/**
 * A line under a panel saying what is missing and why.
 *
 * Takes the reason rather than a generic sentence, because "no data behind
 * this" and "nothing in this system records shift history" send a reader to
 * different places.
 */
export function NotComputedNote({ children }: { children: ReactNode }) {
  return (
    <p
      style={{
        margin: "10px 0 0",
        fontSize: 11.5,
        lineHeight: 1.5,
        color: "var(--fg-4)",
      }}
    >
      {children}
    </p>
  );
}

/**
 * A page-level banner, for a whole screen nothing stands behind.
 *
 * Four console screens were built from the design kit before there was
 * anything to fill them: Run Sheets, Communications, Events and Reports. They
 * are not broken and not placeholders — they are complete screens showing
 * invented records, which is a worse thing to leave unmarked than an empty
 * one, because an empty screen announces itself and these do not.
 *
 * `source` names what would have to exist first, so a reader learns whether
 * this is waiting on a feature or on a decision.
 */
export function NotComputedBanner({ source }: { source: ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        gap: 10,
        alignItems: "flex-start",
        padding: "11px 13px",
        marginBottom: 16,
        borderRadius: 10,
        border: "1px solid var(--border)",
        background: "var(--bg-2, #f8f9fa)",
        fontSize: 12.5,
        lineHeight: 1.55,
        color: "var(--fg-3)",
      }}
    >
      <span
        style={{
          fontSize: 10.5, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase",
          color: "var(--fg-4)", border: "1px solid var(--border)", borderRadius: 999,
          padding: "2px 7px", whiteSpace: "nowrap", flexShrink: 0, marginTop: 1,
        }}
      >
        Illustrative
      </span>
      <span>
        Everything on this screen is example data. Nothing here is folded from the audit chain
        or the time clock, and none of it changes when the venue&rsquo;s week does. {source}
      </span>
    </div>
  );
}
