/* ============================================================
   Awards — public surface. Modules import from "@/lib/awards".
   One pack today (HIGA cl 16). A Restaurant Award pack would sit
   beside it and share the ShiftSession / BreakAssessment shapes.

   higa.ts    the rules — what is owed in TIME, live or retrospectively
   rates.ts   what is owed in MONEY — the award floor, hour by hour
   earnings.ts what a shift already WORKED was worth, from the clock
   report.ts  the payroll fold over a completed week, plus its CSV
   ============================================================ */
export * from "./higa";
export * from "./rates";
export * from "./earnings";
export * from "./report";
export { DEMO_SESSIONS, DEMO_WEEK_SESSIONS, DEMO_WEEK, demoNow } from "./seed";
