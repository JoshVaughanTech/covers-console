"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, Avatar, Badge, Icon, SearchInput, Tabs } from "@/components/ui";
import type { Tone } from "@/lib/status";
import { PageHead } from "@/components/screen/page-head";
import { assessAll, type BreakAssessment, type ShiftSession } from "@/lib/awards";

/* ============================================================
   Time & Attendance — who is actually on the floor.

   This screen used to hold eight hand-written rows: Leanne Vidal
   clocked in at 7:02am, Liam O'Brien eighteen minutes late, Tahlia
   Johnson absent. None of it came from anywhere. It sat beside the
   Break Compliance screen, which reads the same venue's real time
   clock, and looked exactly as authoritative.

   So it reads the clock now — /api/breaks, the same endpoint and
   A panel here showed budgeted hours and a dollar variance per
   function. Nothing records a planned-hours budget and nothing
   prices a variance against one, so it went. What replaced it was
   a card explaining that it had gone, which is a note to a reader
   of this repo rather than to somebody running a floor — they do
   not need to be told daily about a panel they never saw. The
   hours side becomes real when a function carries a budget; the
   money side also needs payroll, which Covers does not process.

   the same assessAll() the break board runs, because two readings
   of one clock is how they come to disagree about who is at work.

   WHAT IS GONE, AND WHY. The old table had "Rostered", "Variance"
   and a Late/Absent status. A ShiftSession carries `plannedEnd`
   and no planned START, so there is nothing to compare a clock-in
   against: lateness is not computable here, and absence is worse —
   detecting it needs a roster of who was expected, and nobody who
   never arrived appears in a list of punches at all.

   Reporting "0 absent" from a source that cannot see absence is
   the failure this console keeps finding: a figure that looks like
   a measurement and is the absence of one. So those columns are
   not filled in with something weaker. They are gone, and the
   screen answers the question it can answer.
   ============================================================ */

const TZ = process.env.NEXT_PUBLIC_TZ_VENUE ?? "Australia/Melbourne";

const FILTERS = ["All", "On the floor", "On a break", "Meal overdue", "Past rostered end"];

const clock = (epoch: number) =>
  new Date(epoch * 1000).toLocaleTimeString("en-AU", {
    hour: "numeric", minute: "2-digit", hour12: true, timeZone: TZ,
  }).replace(" ", "").toLowerCase();

const dur = (sec: number) => {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
};

/** What this person is doing, from the clock alone. */
function state(a: BreakAssessment, now: number): { label: string; tone: Tone } {
  if (!a.onShift) return { label: "Finished", tone: "neutral" };
  if (a.onBreak) return { label: a.onBreak.kind === "meal" ? "On a meal break" : "On a rest break", tone: "info" };
  /* severity, not meal.state — the break board grades the same sessions on
     severity, and two screens deciding "overdue" by different fields is how
     they come to disagree about the same person. 3 is owed now, 2 is due. */
  if (a.severity === 3) return { label: "Meal break overdue", tone: "danger" };
  if (a.severity === 2) return { label: "Meal break due", tone: "warning" };
  if (a.plannedEnd != null && now > a.plannedEnd) return { label: "Past rostered end", tone: "warning" };
  return { label: "On the floor", tone: "success" };
}

export default function AttendancePage() {
  const [sessions, setSessions] = useState<ShiftSession[]>([]);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [asOf, setAsOf] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("All");
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/breaks", { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const b = (await r.json()) as { sessions: ShiftSession[]; asOf?: number };
      setSessions(b.sessions ?? []);
      if (typeof b.asOf === "number") { setAsOf(b.asOf); setNow(b.asOf); }
      setError(null);
    } catch (e) {
      // a floor view that fails silently reads as an empty floor
      setError(e instanceof Error ? e.message : "Could not read the time clock");
    }
  }, []);

  useEffect(() => {
    void load();
    const poll = setInterval(() => void load(), 30_000);
    const tick = setInterval(() => setNow((n) => (asOf ? n : Math.floor(Date.now() / 1000))), 1000);
    return () => { clearInterval(poll); clearInterval(tick); };
  }, [load, asOf]);

  /* The same assessAll() the break board runs. Not a second reading: this
     screen and that one have to agree about who is on a break. */
  const staff = useMemo(() => assessAll(sessions, now, { timezone: TZ }), [sessions, now]);

  const metrics = useMemo(() => {
    const onFloor = staff.filter((a) => a.onShift && !a.onBreak).length;
    const onBreak = staff.filter((a) => a.onShift && a.onBreak).length;
    const overdue = staff.filter((a) => a.onShift && a.severity === 3).length;
    const over = staff.filter((a) => a.onShift && a.plannedEnd != null && now > a.plannedEnd).length;
    return [
      { label: "On the floor", val: onFloor, sub: "clocked in, working", color: "var(--success)", icon: "users" },
      { label: "On a break", val: onBreak, sub: "meal or rest, right now", color: "var(--info)", icon: "coffee" },
      { label: "Meal overdue", val: overdue, sub: "cl 16.6 loading accruing", color: "var(--danger)", icon: "triangle-alert" },
      { label: "Past rostered end", val: over, sub: "still clocked in", color: "var(--warning)", icon: "timer" },
    ];
  }, [staff, now]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return staff.filter((a) => {
      const s = state(a, now).label;
      const matchFilter =
        filter === "All" ||
        (filter === "On the floor" && s === "On the floor") ||
        (filter === "On a break" && Boolean(a.onBreak)) ||
        (filter === "Meal overdue" && a.severity === 3) ||
        (filter === "Past rostered end" && a.plannedEnd != null && now > a.plannedEnd && a.onShift);
      const matchQuery = !q || a.name.toLowerCase().includes(q) || a.role.toLowerCase().includes(q);
      return matchFilter && matchQuery;
    });
  }, [staff, filter, query, now]);

  return (
    <div>
      <PageHead
        title="Time &amp; Attendance"
        sub={asOf ? `From the venue's time clock · as at ${clock(asOf)}` : "From the venue's time clock"}
      />

      {error && (
        <Card style={{ padding: "12px 14px", marginBottom: 14, background: "var(--danger-bg)", color: "var(--danger-fg)", fontSize: 13 }}>
          {error} — this is the clock failing to answer, not an empty floor.
        </Card>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14, marginBottom: 16 }}>
        {metrics.map((m) => (
          <Card key={m.label} style={{ padding: "14px 16px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <Icon name={m.icon} size={15} color={m.color} />
              <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--fg-3)" }}>{m.label}</span>
            </div>
            <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-.02em", color: "var(--fg-1)" }}>{m.val}</div>
            <div style={{ fontSize: 11.5, color: "var(--fg-4)", marginTop: 2 }}>{m.sub}</div>
          </Card>
        ))}
      </div>

      <Card style={{ padding: 0, marginBottom: 16 }}>
        <div style={{ padding: "14px 16px", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <Tabs tabs={FILTERS} value={filter} onChange={setFilter} />
          <div style={{ marginLeft: "auto", minWidth: 220 }}>
            <SearchInput value={query} onChange={setQuery} placeholder="Search name or role…" />
          </div>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--fg-4)", fontSize: 11.5, textTransform: "uppercase", letterSpacing: ".04em" }}>
                <th style={th}>Person</th>
                <th style={th}>Site</th>
                <th style={th}>Clocked in</th>
                <th style={th}>On shift for</th>
                <th style={th}>Rostered end</th>
                <th style={th}>State</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => {
                const s = state(a, now);
                return (
                  <tr key={a.userId} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={td}>
                      <span style={{ display: "flex", alignItems: "center", gap: 9 }}>
                        <Avatar name={a.name} size={28} />
                        <span>
                          <span style={{ display: "block", fontWeight: 600, color: "var(--fg-1)" }}>{a.name}</span>
                          <span style={{ display: "block", fontSize: 11.5, color: "var(--fg-4)" }}>{a.role}</span>
                        </span>
                      </span>
                    </td>
                    <td style={{ ...td, color: "var(--fg-3)" }}>{a.siteName}</td>
                    <td style={{ ...td, whiteSpace: "nowrap" }} className="fs-tnum">{clock(a.clockIn)}</td>
                    <td style={{ ...td, whiteSpace: "nowrap" }} className="fs-tnum">{dur(a.elapsedSec)}</td>
                    <td style={{ ...td, whiteSpace: "nowrap", color: "var(--fg-3)" }} className="fs-tnum">
                      {/* Absent rather than guessed. A punch not linked to a
                          scheduled shift has no rostered end, and an em dash
                          says so where a time would be an invention. */}
                      {a.plannedEnd != null ? clock(a.plannedEnd) : "—"}
                    </td>
                    <td style={td}><Badge tone={s.tone}>{s.label}</Badge></td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ ...td, color: "var(--fg-4)", textAlign: "center", padding: 28 }}>
                    {staff.length === 0 ? "Nobody is clocked in." : "Nobody matches that filter."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

    </div>
  );
}

const th: React.CSSProperties = { padding: "10px 16px", fontWeight: 700 };
const td: React.CSSProperties = { padding: "12px 16px", verticalAlign: "middle" };
