"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, Avatar, Badge, Icon, Button, Tabs, useToast } from "@/components/ui";
import { CardHead, PageHead } from "@/components/screen/page-head";
import {
  HIGA,
  weeklyReport,
  reportToCsv,
  csvFilename,
  lastCompleteWeek,
  fmtClock,
  type ShiftSession,
  type WeeklyBreakReport,
  type BreachRow,
} from "@/lib/awards";

/* ============================================================
   Break Loading — the payroll counterpart to /breaks. That board
   says who is about to cost 50% loading; this says what the week
   already cost, per person, per shift, with the clause attached.

   Nothing ticks here. Every shift in a completed week is closed, so
   the fold is deterministic and the figures are stable enough to
   hand to payroll. The screen owns no award logic: it fetches raw
   sessions and asks lib/awards/report.ts, which is the same code
   the CSV and the test suite run.
   ============================================================ */

const TZ = "Australia/Melbourne";

interface WeekPayload {
  mode: "demo" | "live" | "error";
  start: number;
  end: number;
  sessions: ShiftSession[];
  error?: string;
}

const money = (n: number) => `$${n.toFixed(2)}`;

export default function BreakLoadingPage() {
  const toast = useToast();
  const [payload, setPayload] = useState<WeekPayload | null>(null);
  const [failed, setFailed] = useState(false);
  const [weeksBack, setWeeksBack] = useState(0);
  const [site, setSite] = useState("All venues");
  const [expanded, setExpanded] = useState<string | null>(null);

  const window = useMemo(() => {
    const base = lastCompleteWeek(Math.floor(Date.now() / 1000), TZ);
    const shift = weeksBack * 7 * 86400;
    return { start: base.start - shift, end: base.end - shift };
  }, [weeksBack]);

  useEffect(() => {
    let live = true;
    setPayload(null);
    setFailed(false);
    fetch(`/api/breaks/week?start=${window.start}&end=${window.end}`)
      .then((r) => r.json())
      .then((d: WeekPayload) => live && setPayload(d))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [window.start, window.end]);

  const sessions = payload?.sessions ?? [];

  const sites = useMemo(() => {
    const names = [...new Set(sessions.map((s) => s.siteName))].sort();
    return ["All venues", ...names];
  }, [sessions]);

  const report: WeeklyBreakReport | null = useMemo(() => {
    if (!payload || payload.mode === "error") return null;
    return weeklyReport(sessions, window.start, window.end, {
      timezone: TZ,
      siteName: site === "All venues" ? null : site,
    });
  }, [payload, sessions, window.start, window.end, site]);

  /* a failed fetch must never render as a clean zero — "0 breaches"
     is a substantive payroll claim, not an empty state */
  const unavailable = failed || payload?.mode === "error";

  function exportCsv() {
    if (!report) return;
    const blob = new Blob([reportToCsv(report, TZ)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = csvFilename(report, TZ);
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast(`Exported ${report.totals.breaches} rows`, { tone: "success", icon: "download" });
  }

  const modeBadge = unavailable ? (
    <Badge tone="danger" dot>Connecteam unavailable</Badge>
  ) : payload?.mode === "live" ? (
    <Badge tone="success" dot>Live · Connecteam</Badge>
  ) : (
    <Badge tone="neutral" dot>Demo data</Badge>
  );

  const t = report?.totals;
  const metrics = [
    { label: "Breaches", val: t ? String(t.breaches) : "—", sub: `of ${t?.shiftsAssessed ?? 0} shifts assessed`, color: "var(--danger)", icon: "alarm-clock" },
    { label: "Loading Hours", val: t ? t.loadingHours.toFixed(2) : "—", sub: "cl 16.6 · all rows", color: "var(--warning)", icon: "timer" },
    { label: "Priced Total", val: t ? money(t.pricedAud) : "—", sub: `${t?.pricedRows ?? 0} rows with a rate`, color: "var(--danger)", icon: "banknote" },
    { label: "Unpriced", val: t ? t.unpricedHours.toFixed(2) : "—", sub: `${t?.unpricedRows ?? 0} rows · hours only`, color: "var(--fg-3)", icon: "help-circle" },
    { label: "Open Shifts", val: report ? String(report.openShifts) : "—", sub: "no clock-out · not assessed", color: "var(--info)", icon: "clock" },
  ];

  return (
    <div>
      <PageHead
        title="Break Loading"
        sub={`${HIGA.awardLabel} · cl 16.6 — missed and late meal breaks owed for ${report?.weekLabel ?? "the week"}.`}
        right={
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {modeBadge}
            <Button
              variant="sec"
              size="sm"
              icon="download"
              disabled={!report || report.totals.breaches === 0}
              onClick={exportCsv}
            >
              Export CSV
            </Button>
          </div>
        }
      />

      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
        <Tabs
          tabs={["Last week", "2 weeks ago", "3 weeks ago"]}
          value={["Last week", "2 weeks ago", "3 weeks ago"][weeksBack]}
          onChange={(v) => setWeeksBack(["Last week", "2 weeks ago", "3 weeks ago"].indexOf(v))}
        />
        <Tabs tabs={sites} value={site} onChange={setSite} />
      </div>

      {unavailable ? (
        <Card pad={32}>
          <div style={{ textAlign: "center" }}>
            <Icon name="alert-triangle" size={22} color="var(--danger)" />
            <h4 style={{ margin: "10px 0 4px", fontSize: 15.5 }}>Time-clock data unavailable</h4>
            <p style={{ margin: 0, fontSize: 13, color: "var(--fg-4)", maxWidth: 460, marginInline: "auto" }}>
              No report is shown, because an empty one would read as “nothing owed this week”.
              That is a payroll claim this screen cannot make without the punches to back it.
            </p>
          </div>
        </Card>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 16, marginBottom: 16 }}>
            {metrics.map((m) => (
              <Card key={m.label} pad={16} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 12.5, color: "var(--fg-3)", fontWeight: 600 }}>{m.label}</span>
                  <span style={{ width: 26, height: 26, borderRadius: 7, background: "var(--bg-2)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                    <Icon name={m.icon} size={14} color={m.color} />
                  </span>
                </div>
                <span className="fs-tnum" style={{ fontSize: 30, fontWeight: 800, letterSpacing: "-.02em", color: "var(--fg-1)" }}>{m.val}</span>
                <span style={{ fontSize: 11.5, color: "var(--fg-4)" }}>{m.sub}</span>
              </Card>
            ))}
          </div>

          {report && (report.totals.unpricedRows > 0 || report.openShifts > 0) && (
            <Card pad={14} style={{ marginBottom: 16, borderColor: "var(--warning)", background: "var(--warning-bg)" }}>
              <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                <Icon name="alert-triangle" size={16} color="var(--warning-fg)" />
                <div style={{ fontSize: 12.5, color: "var(--fg-2)", lineHeight: 1.6 }}>
                  {report.totals.unpricedRows > 0 && (
                    <div>
                      <strong>{report.totals.unpricedRows} of {report.totals.breaches} rows have no hourly rate</strong>{" "}
                      and are excluded from the priced total. Their {report.totals.unpricedHours.toFixed(2)} loading hours are still owed —
                      the rate is unknown, not zero.
                    </div>
                  )}
                  {report.openShifts > 0 && (
                    <div>
                      <strong>{report.openShifts} shift{report.openShifts > 1 ? "s" : ""} still open</strong> at week end and not assessed.
                      A shift with no clock-out has no defensible end time.
                    </div>
                  )}
                </div>
              </div>
            </Card>
          )}

          <Card pad={0}>
            <CardHead
              title="By person"
              right={
                report ? (
                  <span className="fs-tnum" style={{ fontSize: 12, fontWeight: 700, color: "var(--fg-3)" }}>
                    {money(report.totals.pricedAud)} owed · {report.totals.loadingHours.toFixed(2)} hrs
                  </span>
                ) : null
              }
            />
            {!payload ? (
              <div style={{ padding: 32, textAlign: "center", fontSize: 13.5, color: "var(--fg-4)" }}>Loading the week…</div>
            ) : !report || report.byPerson.length === 0 ? (
              <div style={{ padding: 32, textAlign: "center", fontSize: 13.5, color: "var(--fg-4)" }}>
                No missed or late meal breaks in {report?.weekLabel ?? "this week"}
                {site !== "All venues" ? ` at ${site}` : ""} — {report?.totals.shiftsAssessed ?? 0} shifts assessed.
              </div>
            ) : (
              report.byPerson.map((p, i) => {
                const rows = report.rows.filter((r) => r.userId === p.userId);
                const open = expanded === p.userId;
                return (
                  <div key={p.userId} style={{ borderTop: i ? "1px solid var(--border)" : 0 }}>
                    <div
                      className="hov-row"
                      onClick={() => setExpanded(open ? null : p.userId)}
                      style={{ display: "grid", gridTemplateColumns: "260px 1fr 110px 120px 28px", gap: 16, alignItems: "center", padding: "12px 20px", cursor: "pointer" }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                        <Avatar name={p.name} size={30} />
                        <span style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: 13, color: "var(--fg-1)" }}>{p.name}</div>
                          <div style={{ fontSize: 11, color: "var(--fg-4)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.role} · {p.siteName}</div>
                        </span>
                      </div>
                      <div style={{ fontSize: 12.5, color: "var(--fg-3)" }}>
                        {p.breaches} breach{p.breaches > 1 ? "es" : ""}
                        {p.unpricedRows > 0 && <span style={{ color: "var(--warning-fg)", fontWeight: 600 }}> · {p.unpricedRows} unpriced</span>}
                      </div>
                      <div className="fs-tnum" style={{ fontSize: 13, textAlign: "right", color: "var(--fg-2)" }}>{p.loadingHours.toFixed(2)} hrs</div>
                      <div className="fs-tnum" style={{ fontSize: 13.5, textAlign: "right", fontWeight: 700, color: p.loadingAud == null ? "var(--fg-4)" : "var(--danger-fg)" }}>
                        {p.loadingAud == null ? "rate unknown" : money(p.loadingAud)}
                      </div>
                      <Icon name={open ? "chevron-up" : "chevron-down"} size={15} color="var(--fg-4)" />
                    </div>

                    {open && (
                      <div style={{ padding: "0 20px 14px 60px", display: "flex", flexDirection: "column", gap: 6 }}>
                        {rows.map((r) => <ShiftLine key={`${r.userId}-${r.clockIn}`} row={r} />)}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </Card>

          {report && report.rows.length > 0 && (
            <p style={{ margin: "14px 2px 0", fontSize: 11.5, color: "var(--fg-4)", lineHeight: 1.6 }}>
              {report.awardId} · {report.awardLabel} · consolidated {report.consolidatedTo}. Loading is +50% of the
              ordinary hourly rate from the 6h mark until the meal break is given or the shift ends (cl 16.5–16.6),
              and stacks on penalty rates (cl 29.3(c)). Not legal advice — verify against any EBA before paying.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function ShiftLine({ row }: { row: BreachRow }) {
  const missed = row.code === "MEAL_MISSED";
  return (
    <div style={{ display: "grid", gridTemplateColumns: "96px 1fr 150px 92px 100px", gap: 12, alignItems: "center", fontSize: 12, color: "var(--fg-3)" }}>
      <span className="fs-tnum">{row.shiftDate}</span>
      <span>
        <Badge tone={missed ? "danger" : "warning"}>{missed ? "No meal break" : "Meal late"}</Badge>
        <span style={{ marginLeft: 8, color: "var(--fg-4)" }}>
          cl {row.clause} · {fmtClock(row.clockIn, TZ)}–{fmtClock(row.clockOut, TZ)} ({row.hoursWorked.toFixed(2)}h)
        </span>
      </span>
      <span className="fs-tnum" style={{ color: "var(--fg-4)" }}>loading {row.window}</span>
      <span className="fs-tnum" style={{ textAlign: "right" }}>{row.loadingHours.toFixed(2)} hrs</span>
      <span className="fs-tnum" style={{ textAlign: "right", fontWeight: 600, color: row.loadingAud == null ? "var(--fg-4)" : "var(--danger-fg)" }}>
        {row.loadingAud == null ? "no rate" : money(row.loadingAud)}
      </span>
    </div>
  );
}
