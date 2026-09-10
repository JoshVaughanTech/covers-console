/* ============================================================
   The reports this venue actually produced.

   Folded from report.delivered on the chain rather than stored
   anywhere, for the same reason the board and the postings are: a
   second list beside the chain is a second list that can disagree
   with it.

   The Reports screen used to carry five of these as literals —
   "Weekly Fairness Summary · PDF · 2 Jun 2026" — with View and
   Download buttons that raised a toast. #48 removed them and put
   nothing back, which was half the job: the real history was
   already on the chain and nobody had looked for it.

   The difference is what a row can be checked against. Every
   delivery records the filename it wrote, the byte count, and a
   SHA-256 of the content, so a row here names a file somebody can
   go and hash. The invented table could not be checked against
   anything, which is what made it furniture.

   Pure, and separate from the screen, so the populated case can be
   tested without a delivered report existing.
   ============================================================ */

import type { AuditEvent } from "../idara/types";

export interface DeliveredReport {
  /** position on the chain — also the React key, and unique by construction. */
  seq: number;
  /** "w/e 6 Sep 2026" */
  weekLabel: string;
  filename: string;
  /** where it was written: a path, or the memory sink in a dry run. */
  target: string;
  /** SHA-256 of the delivered bytes. Empty when an older event omitted it. */
  contentHash: string;
  bytes: number;
  breaches: number;
  loadingHours: number;
  /** "schedule" for the timer, anything else for a hand-run. */
  trigger: string;
}

/**
 * Read a field without inventing one.
 *
 * The chain is append-only and outlives any one shape of this event, so a row
 * written before a field existed has to render as absent rather than as zero.
 * "—" is a missing filename; 0 breaches is a clean week, and the two must not
 * be able to look alike.
 */
const str = (v: unknown, fallback: string): string => (typeof v === "string" ? v : fallback);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/**
 * Every delivered report on the chain, newest first.
 *
 * Newest first because a report library is read from the top, and sorted by
 * seq rather than by the week the report covers: a re-run of an old week is a
 * later fact about that week, and burying it under newer weeks would hide the
 * thing most worth seeing.
 */
export function deliveredReports(log: readonly AuditEvent[]): DeliveredReport[] {
  return log
    .filter((e) => e.type === "report.delivered")
    .map((e) => {
      const d = (e.data ?? {}) as Record<string, unknown>;
      return {
        seq: e.seq,
        weekLabel: str(d.weekLabel, "—"),
        filename: str(d.filename, "—"),
        target: str(d.target, "—"),
        contentHash: str(d.contentHash, ""),
        bytes: num(d.bytes),
        breaches: num(d.breaches),
        loadingHours: num(d.loadingHours),
        trigger: str(d.trigger, "schedule"),
      };
    })
    .sort((a, b) => b.seq - a.seq);
}
