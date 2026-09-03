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

/**
 * Raised when the integration is authenticated but not permitted. Distinct from
 * an outage: the fix is granting a scope in Connecteam, not retrying.
 */
export class ConnecteamScopeError extends Error {
  constructor(readonly scope: string, readonly status: number, readonly path: string) {
    super(`Connecteam ${status} ${path}: the integration is missing the "${scope}" scope`);
    this.name = "ConnecteamScopeError";
  }
}

/** Seconds until a JWT lapses, or null if it cannot be read. */
function jwtExpiry(token: string): number | null {
  try {
    const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()) as { exp?: number };
    return claims.exp ? claims.exp - Date.now() / 1000 : null;
  } catch {
    return null;
  }
}

interface TimePoint { timestamp: number; timezone?: string }
interface CtShift { id: string; start: TimePoint; end: TimePoint | null; schedulerShiftId?: string | null }
interface CtBreak { id?: string; manualBreakId?: string; start: TimePoint; end: TimePoint | null }
interface CtUserRow { userId: number; shifts?: CtShift[]; manualBreaks?: CtBreak[] }
/** A break TYPE as configured on the time clock, not an instance of one. */
export interface CtManualBreak { id: string; name?: string; isPaid?: boolean; duration?: number }
interface CtUser { userId?: number; id?: number; firstName?: string; lastName?: string; employmentType?: string; customFields?: Record<string, string> }

export interface ConnecteamConfig {
  /**
   * OAuth2 client credentials, as issued under Settings → Integrations. This
   * is what a Connecteam integration is given today.
   */
  clientId?: string;
  clientSecret?: string;
  /**
   * Legacy Open API key, sent as X-API-KEY. A client id/secret pair is NOT an
   * API key — passing one here returns 403 "Invalid API key". Supply either
   * this or the client pair.
   */
  apiKey?: string;
  /**
   * One clock, or several separated by commas. An operator with a venue, a
   * gaming room and an off-premise crew runs a clock each, and reading one of
   * them silently shows a third of the floor as the whole floor.
   */
  timeClockId: string;
  schedulerId?: string | null;
  timezone?: string;
  /** map Connecteam userId → site name for the board; optional */
  siteName?: string;
}

/**
 * Meal or rest, decided by what a break IS rather than what it is called.
 *
 * Under the Hospitality Award the meal break is the unpaid one (cl 16.2, at
 * least 30 minutes) and rest breaks are paid (Table 2, 20 minutes). Connecteam
 * returns isPaid and duration on every break type, so payment status is the
 * reliable signal.
 *
 * The name is not. A real venue's configured types are "Break" (unpaid, 30 min)
 * and "Rest Break" (paid, 20 min): a name-based classifier reads the first as a
 * rest break, so the meal is never satisfied, 50% loading accrues from the 6h
 * mark for the whole shift, and the weekly report bills for breaks that were
 * actually taken. That was this function's previous behaviour.
 *
 * Name and duration remain as fallbacks for a clock that omits isPaid.
 */
export function classifyBreak(b: CtManualBreak): BreakKind {
  if (b.isPaid === false) return "meal";
  if (b.isPaid === true) return "rest";
  if (/meal|lunch|dinner|unpaid/i.test(b.name ?? "")) return "meal";
  if (/rest|tea|smoko|coffee/i.test(b.name ?? "")) return "rest";
  // last resort: a meal break is long, a rest break is short
  return (b.duration ?? 0) >= 30 ? "meal" : "rest";
}

export class ConnecteamClient {
  private users: Map<number, CtUser> | null = null;
  private breakKinds: Map<string, BreakKind> | null = null;
  /**
   * Scopes this integration turned out not to hold, discovered by being
   * refused. Surfaced rather than swallowed: a compliance check that is off
   * because of a permission looks exactly like one that passed.
   */
  private readonly refused = new Set<string>();

  /** cached bearer token; refreshed a minute before it lapses */
  private token: { value: string; expiresAt: number } | null = null;
  /**
   * The exchange in flight, if any. sessions() issues its three reads in
   * parallel, so without this each one sees an empty cache and mints its own
   * token — three exchanges where one was needed, on every cold call.
   */
  private tokenInflight: Promise<string> | null = null;
  constructor(private cfg: ConnecteamConfig) {
    if (!cfg.apiKey && !(cfg.clientId && cfg.clientSecret)) {
      throw new Error("ConnecteamClient needs either apiKey or clientId + clientSecret");
    }
  }

  /**
   * OAuth2 client_credentials, exchanged over HTTP Basic. The token lasts about
   * a day, so it is cached rather than re-minted per request; a minute of slack
   * avoids using one that expires mid-flight.
   */
  private async accessToken(): Promise<string> {
    const now = Date.now() / 1000;
    if (this.token && this.token.expiresAt - 60 > now) return this.token.value;
    // concurrent callers share one exchange rather than racing to mint
    this.tokenInflight ??= this.exchange().finally(() => { this.tokenInflight = null; });
    return this.tokenInflight;
  }

  private async exchange(): Promise<string> {
    const now = Date.now() / 1000;
    const basic = Buffer.from(`${this.cfg.clientId}:${this.cfg.clientSecret}`).toString("base64");
    const res = await fetch(BASE + "/oauth/v1/token", {
      method: "POST",
      headers: { authorization: `Basic ${basic}`, "content-type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials",
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Connecteam token exchange ${res.status}: ${await res.text()}`);
    const body = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!body.access_token) throw new Error("Connecteam token exchange returned no access_token");

    this.token = { value: body.access_token, expiresAt: now + (body.expires_in ?? jwtExpiry(body.access_token) ?? 3600) };
    return this.token.value;
  }

  private async authHeaders(): Promise<Record<string, string>> {
    if (this.cfg.apiKey) return { "X-API-KEY": this.cfg.apiKey };
    return { Authorization: `Bearer ${await this.accessToken()}` };
  }

  private async get<T>(path: string, params: Record<string, string | string[] | undefined> = {}): Promise<T> {
    const url = new URL(BASE + path);
    for (const [k, v] of Object.entries(params)) {
      if (v == null) continue;
      if (Array.isArray(v)) v.forEach((x) => url.searchParams.append(k, x));
      else url.searchParams.set(k, v);
    }
    const res = await fetch(url, { headers: { ...(await this.authHeaders()), accept: "application/json" }, cache: "no-store" });
    if (!res.ok) {
      const text = await res.text();
      // a scope failure is a configuration problem, not an outage — say so
      const scope = text.match(/required scope: ([\w.]+)/)?.[1];
      if (scope) throw new ConnecteamScopeError(scope, res.status, path);
      throw new Error(`Connecteam ${res.status} ${path}: ${text}`);
    }
    return (await res.json()).data as T;
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(BASE + path, {
      method: "POST",
      headers: { ...(await this.authHeaders()), accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    if (!res.ok) {
      const text = await res.text();
      const scope = text.match(/required scope: ([w.]+)/)?.[1];
      if (scope) throw new ConnecteamScopeError(scope, res.status, path);
      throw new Error(`Connecteam ${res.status} ${path}: ${text}`);
    }
    return ((await res.json()) as { data?: T }).data as T;
  }

  /**
   * Start a manual break for one user — the write that makes a supervisor's
   * decision real in the customer's timesheet rather than only in ours.
   *
   * Needs time_clock.write. Without it this throws ConnecteamScopeError, which
   * the caller records as a failed push rather than swallowing.
   */
  async startBreak(manualBreakId: string, userRef: string, at: string): Promise<{ ctBreakId: string }> {
    // subjects are DIDs in Covers; Connecteam wants its own numeric user id
    const userId = Number(userRef.split(":").pop());
    if (!Number.isFinite(userId)) throw new Error(`cannot map "${userRef}" to a Connecteam userId`);

    const r = await this.post<{ id?: string; manualBreakId?: string }>(
      `/time-clock/v1/time-clocks/${this.cfg.timeClockId}/manual-breaks/${manualBreakId}/clock-in`,
      { userId, timestamp: Math.floor(Date.parse(at) / 1000) },
    );
    return { ctBreakId: r?.id ?? r?.manualBreakId ?? manualBreakId };
  }

  private localDate(ts: number, offsetDays = 0): string {
    return new Date((ts + offsetDays * 86400) * 1000).toLocaleDateString("en-CA", { timeZone: this.cfg.timezone ?? "Australia/Melbourne" });
  }

  /**
   * Names and employment type, when the integration is allowed to read them.
   *
   * An integration granted only time_clock.read still gets every punch, and the
   * punches are the compliance data — a name is a label on top of them. So a
   * users.read refusal degrades to an empty map rather than taking the whole
   * board down, and people appear by id until the scope is granted. Any other
   * failure still throws: an outage is not the same as a permission.
   */
  private async loadUsers(): Promise<Map<number, CtUser>> {
    if (!this.users) {
      try {
        const d = await this.get<{ users?: CtUser[] }>("/users/v1/users", { limit: "200" });
        this.users = new Map((d.users ?? []).map((u) => [(u.userId ?? u.id) as number, u]));
      } catch (e) {
        if (!(e instanceof ConnecteamScopeError)) throw e;
        this.refused.add(e.scope);
        this.users = new Map();
      }
    }
    return this.users;
  }

  private async loadBreakKinds(): Promise<Map<string, BreakKind>> {
    if (!this.breakKinds) {
      /* Each clock configures its own break types, and they genuinely differ:
         one account has "Break" (unpaid 30m) on two clocks and "Lunch break"
         on a third. Ids are unique across clocks, so one map serves all. */
      const perClock = await Promise.all(
        this.clockIds().map((id) =>
          this.get<{ manualBreaks?: CtManualBreak[] }>(`/time-clock/v1/time-clocks/${id}/manual-breaks`),
        ),
      );
      this.breakKinds = new Map(
        perClock.flatMap((d) => (d.manualBreaks ?? []).map((b) => [b.id, classifyBreak(b)] as const)),
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

  /** The clocks configured, in order. */
  private clockIds(): string[] {
    return String(this.cfg.timeClockId)
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
  }

  /**
   * What this integration could not read, and what that costs.
   *
   * Returned to the client so a screen can say which checks are inactive.
   * Without users.read there is no employmentType, so the casual 12h cap
   * (cl 11.2/11.4) cannot be evaluated at all — and an unevaluated check
   * renders identically to a passing one, which is the failure this exists
   * to prevent.
   */
  degradations(): { scope: string; effect: string }[] {
    const effects: Record<string, string> = {
      "users.read": "Names show as ids, and the casual 12h cap (cl 11.2) cannot be checked — employment type is unknown.",
      "pay_rates.read": "Loading is shown in hours only; no dollar figures.",
      "jobs.read": "Per-shift duties fall back to job title.",
    };
    return [...this.refused].map((scope) => ({ scope, effect: effects[scope] ?? "Some data is unavailable." }));
  }

  /** Everyone with an open shift right now (plus completed today when includeCompleted). */
  async sessions(now = Math.floor(Date.now() / 1000), includeCompleted = false): Promise<ShiftSession[]> {
    const clocks = this.clockIds();
    const [users, kinds, ...perClock] = await Promise.all([
      this.loadUsers(),
      this.loadBreakKinds(),
      ...clocks.map((id) =>
        this.get<{ timeActivitiesByUsers?: CtUserRow[] }>(`/time-clock/v1/time-clocks/${id}/time-activities`, {
          startDate: this.localDate(now, -1),
          endDate: this.localDate(now),
          activityTypes: ["shift", "manual_break"],
        }),
      ),
    ]);

    const rows = perClock.flatMap((d) => d.timeActivitiesByUsers ?? []);
    const out: ShiftSession[] = [];
    for (const row of rows) {
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
