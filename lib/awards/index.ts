/* ============================================================
   Awards — public surface. Modules import from "@/lib/awards".
   One pack today (HIGA cl 16). A Restaurant Award pack would sit
   beside it and share the ShiftSession / BreakAssessment shapes.

   higa.ts    the rules — what is owed, live or retrospectively
   report.ts  the payroll fold over a completed week, plus its CSV
   ============================================================ */
export * from "./higa";
export * from "./report";
export { DEMO_SESSIONS, DEMO_WEEK_SESSIONS, DEMO_WEEK, demoNow } from "./seed";
