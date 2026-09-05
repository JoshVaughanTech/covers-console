/* ============================================================
   Payroll — public surface.

   types.ts    the connector interface, one method per employment act
   mock.ts     the demo payroll and time clock
   provision.ts  the only place a pack payload is decrypted

   SERVER ONLY. provision.ts reaches the vault, which reaches
   node:crypto, so importing this barrel from a client component
   pulls Node built-ins into a browser bundle. A screen that needs
   the connector ids imports "@/lib/payroll/types" — types and
   labels, no runtime — the same split lib/shifts/board.ts makes
   when it imports the seed directly rather than through the barrel.
   ============================================================ */

export * from "./types";
export { MockPayrollConnector, MockTimeClock, mockPayroll, mockTimeClock } from "./mock";
export type { EmployeeSummary } from "./mock";
export { provisionEngagement, ProvisionError } from "./provision";
export type { ProvisionInput, ProvisionResult } from "./provision";
