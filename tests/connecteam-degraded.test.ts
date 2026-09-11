import { describe, it, expect, vi, afterEach } from "vitest";
import { ConnecteamClient } from "../lib/integrations/connecteam";

/* ============================================================
   Several clocks: reading all of them, writing to one of them, and
   admitting what could not be read.

   Three failures this pins, all of the same kind: doing less than
   claimed without saying so.

   Reading one clock when three are configured shows a third of the
   floor as though it were the whole floor. Writing to "1,2,3" as
   though it were a clock id fails every push — the mirror of the
   first, and it survived because reading and writing were correct
   and incorrect at the same time with nothing connecting them. And
   without users.read there is no employmentType, so the casual 12h
   cap (cl 11.2/11.4) cannot be evaluated — an unevaluated check
   renders identically to a passing one, which is worse than an error.
   ============================================================ */

const TOKEN_URL = "https://api.connecteam.com/oauth/v1/token";

const jwt = () =>
  `h.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url")}.s`;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const scopeRefusal = (scope: string) =>
  json({ error: `Token missing required scope: ${scope}`, details: null }, 403);

afterEach(() => vi.unstubAllGlobals());

/** A punch for one person on one clock. */
const activity = (userId: number, start: number) => ({
  userId,
  shifts: [{ id: `s${userId}`, start: { timestamp: start }, end: null }],
  manualBreaks: [],
});

function stub({ clocks, refuseUsers = true }: { clocks: Record<string, number[]>; refuseUsers?: boolean }) {
  const hits: string[] = [];
  vi.stubGlobal("fetch", async (input: string | URL) => {
    const url = String(input);
    hits.push(url);
    if (url === TOKEN_URL) return json({ access_token: jwt(), expires_in: 3600 });
    if (url.includes("/users/v1/users")) {
      return refuseUsers ? scopeRefusal("users.read") : json({ data: { users: [] } });
    }
    if (url.includes("manual-breaks")) {
      const id = url.match(/time-clocks\/([^/]+)\//)?.[1] ?? "";
      // each clock names its own types — one account really does have
      // "Break" on two clocks and "Lunch break" on a third
      return json({ data: { manualBreaks: [{ id: `mb-${id}`, name: "Break", isPaid: false, duration: 30 }] } });
    }
    if (url.includes("time-activities")) {
      const id = url.match(/time-clocks\/([^/]+)\//)?.[1] ?? "";
      return json({ data: { timeActivitiesByUsers: (clocks[id] ?? []).map((u) => activity(u, 1_700_000_000)) } });
    }
    return json({ data: {} });
  });
  return hits;
}

describe("reading every configured clock", () => {
  it("merges people across all of them", async () => {
    stub({ clocks: { "1": [11, 12], "2": [21], "3": [31, 32, 33] } });
    const c = new ConnecteamClient({ timeClockId: "1,2,3", clientId: "i", clientSecret: "s" });
    const sessions = await c.sessions(1_700_003_600, false);

    expect(sessions).toHaveLength(6);
    expect(sessions.map((s) => s.userId).sort()).toEqual(
      ["ct:11", "ct:12", "ct:21", "ct:31", "ct:32", "ct:33"],
    );
  });

  it("still reads a single clock, so existing configuration keeps working", async () => {
    stub({ clocks: { "42": [1, 2] } });
    const c = new ConnecteamClient({ timeClockId: "42", clientId: "i", clientSecret: "s" });
    expect(await c.sessions(1_700_003_600, false)).toHaveLength(2);
  });

  it("tolerates spacing in the configured list", async () => {
    stub({ clocks: { "1": [1], "2": [2] } });
    const c = new ConnecteamClient({ timeClockId: " 1 , 2 ", clientId: "i", clientSecret: "s" });
    expect(await c.sessions(1_700_003_600, false)).toHaveLength(2);
  });

  it("loads break types from every clock, not just the first", async () => {
    const hits = stub({ clocks: { "1": [1], "2": [2], "3": [3] } });
    const c = new ConnecteamClient({ timeClockId: "1,2,3", clientId: "i", clientSecret: "s" });
    await c.sessions(1_700_003_600, false);
    const breakCalls = hits.filter((h) => h.includes("manual-breaks"));
    // a clock whose types were never loaded would classify its breaks by default
    expect(breakCalls).toHaveLength(3);
  });
});

describe("writing to the clock that owns the break", () => {
  /* CONNECTEAM_TIME_CLOCK_ID is a list because reading merges clocks. A URL
     is not: a manual break starts on exactly one. Which one is decided by
     the break type, since break types are configured per clock. */
  it("starts the break on the clock the break type belongs to", async () => {
    const hits = stub({ clocks: { "1": [11], "2": [21], "3": [31] } });
    const c = new ConnecteamClient({ timeClockId: "1,2,3", clientId: "i", clientSecret: "s" });

    await c.startBreak("mb-2", "ct:21", "2026-09-11T03:00:00.000Z");

    const clockIn = hits.filter((u) => u.includes("/clock-in"));
    expect(clockIn).toHaveLength(1);
    expect(clockIn[0]).toContain("/time-clocks/2/manual-breaks/mb-2/clock-in");
    // the bug: the raw setting interpolated into the path
    expect(clockIn[0]).not.toContain("1,2,3");
  });

  it("needs no lookup when one clock is configured", async () => {
    const hits = stub({ clocks: { "42": [1] } });
    const c = new ConnecteamClient({ timeClockId: "42", clientId: "i", clientSecret: "s" });

    await c.startBreak("mb-42", "ct:1", "2026-09-11T03:00:00.000Z");

    expect(hits.filter((u) => u.includes("/clock-in"))[0]).toContain("/time-clocks/42/");
    // there is nowhere else it could go, so the break list is never fetched
    expect(hits.some((u) => u.includes("manual-breaks") && !u.includes("clock-in"))).toBe(false);
  });

  it("refuses rather than guessing when the break type is on no configured clock", async () => {
    stub({ clocks: { "1": [11], "2": [21] } });
    const c = new ConnecteamClient({ timeClockId: "1,2", clientId: "i", clientSecret: "s" });

    /* Writing it to whichever clock came first would put a real break on the
       wrong person's timesheet. sendOnBreak records the throw as a failed
       push, which is recoverable; a break on the wrong clock is not. */
    await expect(c.startBreak("mb-elsewhere", "ct:11", "2026-09-11T03:00:00.000Z")).rejects.toThrow(
      /mb-elsewhere/,
    );
  });
});

describe("admitting what could not be read", () => {
  it("names the missing scope and what it disables", async () => {
    stub({ clocks: { "1": [1] } });
    const c = new ConnecteamClient({ timeClockId: "1", clientId: "i", clientSecret: "s" });
    await c.sessions(1_700_003_600, false);

    const d = c.degradations();
    expect(d).toHaveLength(1);
    expect(d[0].scope).toBe("users.read");
    // the effect must name the check, not just the data — "names show as ids"
    // alone would let someone assume the award logic was unaffected
    expect(d[0].effect).toMatch(/casual 12h cap|cl 11\.2/i);
  });

  it("reports nothing when every scope was granted", async () => {
    stub({ clocks: { "1": [1] }, refuseUsers: false });
    const c = new ConnecteamClient({ timeClockId: "1", clientId: "i", clientSecret: "s" });
    await c.sessions(1_700_003_600, false);
    expect(c.degradations()).toEqual([]);
  });

  it("leaves employmentType null rather than guessing, so the cap cannot silently pass", async () => {
    stub({ clocks: { "1": [1] } });
    const c = new ConnecteamClient({ timeClockId: "1", clientId: "i", clientSecret: "s" });
    const [session] = await c.sessions(1_700_003_600, false);
    // null, not "casual" and not "full_time" — either guess would make the
    // 12h cap either fire wrongly or stay off while appearing to have run
    expect(session.employmentType).toBeNull();
  });
});
