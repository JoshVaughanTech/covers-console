/* ============================================================
   Shifts — public surface

   engage.ts is deliberately NOT re-exported. It reaches the pack
   seed, which reaches the vault, which reaches node:crypto — and
   this barrel is imported by /open-shifts, a client component. One
   re-export here would pull Node built-ins into a browser bundle
   and the failure would be a build error a long way from its cause.
   Server code imports "@/lib/shifts/engage" by path.
   ============================================================ */

export * from "./types";
export * from "./claim";
export * from "./gate";
export * from "./board";
export * from "./draft";
export * from "./pay";
export * from "./review";
export * from "./unlocks";
export * from "./replay";
/* Safe here where engage.ts is not: timesheet.ts reads the clock's shape and
   the engagement's, both of which are pure. It reaches no vault and no seed. */
export * from "./timesheet";
export { POSTINGS } from "./seed";
