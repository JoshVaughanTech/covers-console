/* ============================================================
   Connecteam → ShiftSession adapter (server-only).
   Docs: https://developer.connecteam.com

   GET /time-clock/v1/time-clocks/{id}/time-activities?startDate&endDate
       → shifts + manualBreaks per user; an open shift has end == null
   GET /time-clock/v1/time-clocks/{id}/manual-breaks
       → break type definitions; we classify meal vs rest by name
   GET /users/v1/users → names, employment type
   GET /scheduler/v1/schedulers/{sid}/shifts/{shiftId} → rostered end

   Auth: X-API-KEY (or OAuth2 bearer, scope time_clock.read).
   The Time Clock API is a paid Connecteam add-on ("Operations API").
   Polling suits a POC; production should subscribe to the
   time_activity webhook (clock_in / clock_out) and re-pull on events.
   ============================================================ */

import type { ShiftSession, EmploymentType, BreakKind } from "@/lib/awards";

const BASE = "https://api.connecteam.com";

interface TimePoint { timestamp: number; timezone?: string }
interface CtShift { id: string; start: TimePoint; end: TimePoint | null; schedulerShiftId?: string | null }
interface CtBreak { id?: string; manualBreakId?: string; start: TimePoint; end: TimePoint | null }
interface CtUserRow { userId: number; shifts?: CtShift[]; manualBreaks?: CtBreak[] }
interface CtUser { userId?: number; id?: number; firstName?: string; lastName?: string; employmentType?: string; customFields?: Record<string, string> }

export interface ConnecteamConfig {
  apiKey: string;
  timeClockId: string;
  schedulerId?: string | null;
  timezone?: string;
  /** map Connecteam userId → site name for the board; optional */
  siteName?: string;
}

export class ConnecteamClient {
  private users: Map<number, CtUser> | null = null;
  private breakKinds: Map<string, BreakKind> | null = null;
  constructor(private cfg: ConnecteamConfig) {}

  private async get<T>(path: string, params: Record<string, string | string[] | undefined> = {}): Promise<T> {
    const url = new URL(BASE + path);
    for (const [k, v] of Object.entries(params)) {
      if (v == null) continue;
      if (Array.isArray(v)) v.forEach((x) => url.searchParams.append(k, x));
      else url.searchParams.set(k, v);
    }
    const res = await fetch(url, { headers: { "X-API-KEY": this.cfg.apiKey, accept: "application/json" }, cache: "no-store" });
    if (!res.ok) throw new Error(`Connecteam ${res.status} ${path}: ${await res.text()}`);
    return (await res.json()).data as T;
  }

  private localDate(ts: number, offsetDays = 0): string {
    return new Date((ts + offsetDays * 86400) * 1000).toLocaleDateString("en-CA", { timeZone: this.cfg.timezone ?? "Australia/Melbourne" });
  }

  private async loadUsers(): Promise<Map<number, CtUser>> {
    if (!this.users) {
      const d = await this.get<{ users?: CtUser[] }>("/users/v1/users", { limit: "200" });
      this.users = new Map((d.users ?? []).map((u) => [(u.userId ?? u.id) as number, u]));
    }
    return this.users;
  }

  private async loadBreakKinds(): Promise<Map<string, BreakKind>> {
    if (!this.breakKinds) {
      const d = await this.get<{ manualBreaks?: { id: string; name?: string }[] }>(`/time-clock/v1/time-clocks/${this.cfg.timeClockId}/manual-breaks`);
      this.breakKinds = new Map(
        (d.manualBreaks ?? []).map((b) => [b.id, /meal|lunch|dinner|unpaid/i.test(b.name ?? "") ? "meal" : "rest"]),
      );
    }
    return this.breakKinds;
  }

  private async plannedEnd(schedulerShiftId?: string | null): Promise<number | null> {
    if (!schedulerShiftId || !this.cfg.schedulerId) return null;
    try {
      const d = await this.get<{ shift?: { endTime?: number }; endTime?: number }>(`/scheduler/v1/schedulers/${this.cfg.schedulerId}/shifts/${schedulerShiftId}`);
      return d.shift?.endTime ?? d.endTime ?? null;
    } catch {
      return null;
    }
  }

  /** Everyone with an open shift right now (plus completed today when includeCompleted). */
  async sessions(now = Math.floor(Date.now() / 1000), includeCompleted = false): Promise<ShiftSession[]> {
    const [users, kinds, data] = await Promise.all([
      this.loadUsers(),
      this.loadBreakKinds(),
      this.get<{ timeActivitiesByUsers?: CtUserRow[] }>(`/time-clock/v1/time-clocks/${this.cfg.timeClockId}/time-activities`, {
        startDate: this.localDate(now, -1),
        endDate: this.localDate(now),
        activityTypes: ["shift", "manual_break"],
      }),
    ]);

    const out: ShiftSession[] = [];
    for (const row of data.timeActivitiesByUsers ?? []) {
      const u = users.get(row.userId) ?? {};
      const name = [u.firstName, u.lastName].filter(Boolean).join(" ") || `User ${row.userId}`;
      const breaks = (row.manualBreaks ?? []).map((b) => ({
        kind: kinds.get(b.manualBreakId ?? b.id ?? "") ?? ("rest" as BreakKind),
        start: b.start.timestamp,
        end: b.end?.timestamp ?? null,
      }));
      for (const s of mergeShifts(row.shifts ?? [])) {
        if (!includeCompleted && s.end != null) continue;
        out.push({
          userId: `ct:${row.userId}`,
          name,
          role: "",
          siteName: this.cfg.siteName ?? "",
          clockIn: s.start,
          clockOut: s.end,
          plannedEnd: await this.plannedEnd(s.schedulerShiftId),
          breaks: breaks.filter((b) => b.start >= s.start - 60 && (s.end == null || b.start <= s.end + 60)),
          employmentType: employment(u),
          ordinaryHourlyRate: null,
        });
      }
    }
    return out;
  }
}

/** Punches < 90 min apart are one shift; the gap is the break. */
export function mergeShifts(shifts: CtShift[], maxGapSec = 90 * 60): { start: number; end: number | null; schedulerShiftId: string | null }[] {
  const sorted = [...shifts].sort((a, b) => a.start.timestamp - b.start.timestamp);
  const out: { start: number; end: number | null; schedulerShiftId: string | null }[] = [];
  for (const s of sorted) {
    const cur = { start: s.start.timestamp, end: s.end?.timestamp ?? null, schedulerShiftId: s.schedulerShiftId ?? null };
    const last = out[out.length - 1];
    if (last && last.end != null && cur.start - last.end <= maxGapSec) {
      last.end = cur.end;
      last.schedulerShiftId ||= cur.schedulerShiftId;
    } else out.push(cur);
  }
  return out;
}

function employment(u: CtUser): EmploymentType | null {
  const raw = String(u.employmentType ?? u.customFields?.employmentType ?? "").toLowerCase();
  if (raw.includes("casual")) return "casual";
  if (raw.includes("part")) return "part_time";
  if (raw.includes("full")) return "full_time";
  return null;
}
