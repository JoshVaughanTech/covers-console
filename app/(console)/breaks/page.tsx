"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, Avatar, Badge, Icon, Button, Modal, SearchInput, Tabs, Field, useToast } from "@/components/ui";
import type { Tone } from "@/lib/status";
import { CardHead, LinkBtn, PageHead } from "@/components/screen/page-head";
import { useIdara } from "@/lib/idara";
import {
  HIGA,
  assessAll,
  summariseBoard,
  fmtClock,
  fmtDuration,
  type BreakAssessment,
  type BreakRequirement,
  type BreakKind,
  type ShiftSession,
  type Severity,
} from "@/lib/awards";

/* ============================================================
   Break Compliance — live Table 2 entitlements per clocked-in
   person under the Hospitality Award (cl 16), driven by Connecteam
   punches. The screen owns nothing about the award: it fetches raw
   sessions from /api/breaks and asks the awards pack every second.
   Sending someone on a break writes a hash-chained audit event, so
   "we gave Darie her meal break at 12:04" is provable later.
   ============================================================ */

const TZ = "Australia/Melbourne";
const FILTERS = ["All", "Overdue", "Due", "On break", "Clear"];

interface BoardPayload {
  mode: "live" | "demo" | "error";
  asOf?: number;
  sessions: ShiftSession[];
  error?: string;
  /** Checks that cannot run because the integration lacks a scope. */
  degraded?: { scope: string; effect: string }[];
}

const SEV_TONE: Record<Severity, Tone> = { 0: "success", 1: "info", 2: "warning", 3: "danger" };
const SEV_LABEL: Record<Severity, string> = { 0: "Clear", 1: "Note", 2: "Due", 3: "Overdue" };
const SEV_COLOR: Record<Severity, string> = { 0: "var(--success)", 1: "var(--info)", 2: "var(--warning)", 3: "var(--danger)" };

const REQ_TONE: Record<string, Tone> = {
  taken: "success",
  in_progress: "info",
  due: "warning",
  due_soon: "warning",
  overdue: "danger",
  not_yet: "neutral",
  pending: "neutral",
  window_open: "teal",
  elective: "neutral",
  none: "neutral",
};

function reqValue(q: BreakRequirement): string {
  if (q.kind === "meal") {
    switch (q.state) {
      case "taken": return `Taken ${fmtClock(q.takenAt!, TZ)}`;
      case "in_progress": return "On break now";
      case "not_yet": return `From ${fmtClock(q.windowOpen!, TZ)}`;
      case "window_open":
      case "due_soon": return `By ${fmtClock(q.deadline!, TZ)}`;
      case "overdue": return `Overdue ${fmtClock(q.deadline!, TZ)}`;
      case "elective": return "On request";
      default: return q.state;
    }
  }
  if (q.kind === "rest") {
    const nxt = q.suggestedAt?.[0];
    return q.state === "taken" ? `${q.credited}/${q.required} taken` : `${q.credited}/${q.required}${nxt ? ` · next ~${fmtClock(nxt, TZ)}` : ""}`;
  }
  return q.state === "overdue" ? "Owed now" : `By ${fmtClock(q.deadline!, TZ)}`;
}

/** Shift timeline: elapsed fill, break segments, 2h / 6h meal ticks. */
function ShiftTimeline({ p, now }: { p: BreakAssessment; now: number }) {
  const elapsed = p.onShift ? now - p.clockIn : p.elapsedSec;
  const span = Math.max(p.expectedSec, elapsed, HIGA.MEAL_DEADLINE + 600);
  const pct = (t: number) => Math.min(100, Math.max(0, ((t - p.clockIn) / span) * 100));
  const fill = p.severity === 3 ? "var(--danger)" : p.severity === 2 ? "var(--warning)" : "var(--fs-teal)";
  return (
    <div style={{ position: "relative", height: 8, background: "var(--bg-2)", borderRadius: 999, marginTop: 8, marginBottom: p.bracket.meal === "mandatory" ? 14 : 4 }}>
      <div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: `${pct(now)}%`, background: fill, borderRadius: 999, opacity: 0.85 }} />
      {p.breaks.map((b, i) => (
        <div key={i} title={`${b.kind} break`} style={{ position: "absolute", top: 0, height: "100%", left: `${pct(b.start)}%`, width: `${Math.max(1, pct(b.end ?? now) - pct(b.start))}%`, background: "var(--info)", borderRadius: 3 }} />
      ))}
      {p.bracket.meal === "mandatory" && (
        <>
          <Tick at={pct(p.meal.earliestAt)} label="2h" />
          <Tick at={pct(p.meal.deadlineAt)} label="6h" hard />
        </>
      )}
    </div>
  );
}
function Tick({ at, label, hard }: { at: number; label: string; hard?: boolean }) {
  return (
    <div style={{ position: "absolute", left: `${at}%`, top: -3, width: 2, height: 14, background: hard ? "var(--danger)" : "var(--border-2)" }}>
      <span style={{ position: "absolute", top: 15, left: "50%", transform: "translateX(-50%)", fontSize: 9.5, fontWeight: 700, color: hard ? "var(--danger-fg)" : "var(--fg-4)", letterSpacing: ".04em" }}>{label}</span>
    </div>
  );
}

export default function BreaksPage() {
  const toast = useToast();
  const { recordEvent, today } = useIdara();

  const [payload, setPayload] = useState<BoardPayload | null>(null);
  const [sessions, setSessions] = useState<ShiftSession[]>([]);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [filter, setFilter] = useState("All");
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/breaks", { cache: "no-store" });
      const j = (await r.json()) as BoardPayload;
      setPayload(j);
      // Keep local optimistic breaks (sent from this console) until the source catches up.
      setSessions((prev) => {
        const local = new Map(prev.map((s) => [s.userId, s]));
        return j.sessions.map((s) => {
          const l = local.get(s.userId);
          if (!l) return s;
          const open = l.breaks.find((b) => b.end == null && !s.breaks.some((x) => x.start === b.start));
          return open ? { ...s, breaks: [...s.breaks, open] } : s;
        });
      });
    } catch (e) {
      setPayload({ mode: "error", sessions: [], error: (e as Error).message });
    }
  }, []);

  useEffect(() => {
    load();
    const poll = setInterval(load, 30_000);
    const tick = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => { clearInterval(poll); clearInterval(tick); };
  }, [load]);

  const staff = useMemo(() => assessAll(sessions, now, { timezone: TZ }), [sessions, now]);
  const summary = useMemo(() => summariseBoard(staff), [staff]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return staff.filter((p) => {
      const f =
        filter === "All" ||
        (filter === "Overdue" && p.severity === 3) ||
        (filter === "Due" && p.severity === 2) ||
        (filter === "On break" && !!p.onBreak) ||
        (filter === "Clear" && p.severity <= 1 && !p.onBreak);
      return f && (!q || p.name.toLowerCase().includes(q) || p.role.toLowerCase().includes(q) || p.siteName.toLowerCase().includes(q));
    });
  }, [staff, filter, query]);

  const queue = useMemo(() => staff.filter((p) => p.severity >= 2 && !p.onBreak).slice(0, 5), [staff]);
  const accruing = useMemo(() => staff.filter((p) => p.penalty?.accruing), [staff]);
  const active = openId ? staff.find((p) => p.userId === openId) ?? null : null;

  function sendOnBreak(p: BreakAssessment, kind: BreakKind) {
    const start = Math.floor(Date.now() / 1000);
    setSessions((list) => list.map((s) => (s.userId === p.userId ? { ...s, breaks: [...s.breaks, { kind, start, end: null }] } : s)));
    const overdue = p.severity === 3;
    recordEvent({
      type: "break.decision",
      at: today,
      actor: "Supervisor",
      subject: `did:web:idara.app:${p.userId}`,
      summary: `${p.name} sent on ${kind} break at ${fmtClock(start, TZ)}${overdue ? " (overdue — cl 16.6 loading applies)" : ""}`,
      data: { award: HIGA.awardId, clause: kind === "meal" ? "16.2" : "16.2/16.7", kind, elapsedSec: p.elapsedSec, overdue, penaltySec: p.penalty?.seconds ?? 0, penaltyAud: p.penalty?.estimateAud ?? null },
    });
    toast(`${p.name} sent on ${kind} break`, { tone: overdue ? "warning" : "success", icon: "coffee" });
    setOpenId(null);
  }

  function endBreak(p: BreakAssessment) {
    const end = Math.floor(Date.now() / 1000);
    setSessions((list) => list.map((s) => (s.userId === p.userId ? { ...s, breaks: s.breaks.map((b) => (b.end == null ? { ...b, end } : b)) } : s)));
    toast(`${p.name} back on shift`, { tone: "success", icon: "play" });
    setOpenId(null);
  }

  const modeBadge =
    payload?.mode === "live" ? <Badge tone="success" dot>Live · Connecteam</Badge>
    : payload?.mode === "error" ? <Badge tone="danger" dot>Connecteam unavailable</Badge>
    : <Badge tone="neutral" dot>Demo data</Badge>;

  const metrics: { label: string; val: string; sub: string; color: string; icon: string }[] = [
    { label: "On Shift", val: String(summary.onShift), sub: `${sessions.length} clocked in`, color: "var(--fs-teal)", icon: "users" },
    { label: "Overdue", val: String(summary.overdue), sub: "Loading accruing now", color: "var(--danger)", icon: "alarm-clock" },
    { label: "Due Now", val: String(summary.dueNow), sub: "Within the next hour", color: "var(--warning)", icon: "timer" },
    { label: "On Break", val: String(summary.onBreak), sub: "Meal or rest in progress", color: "var(--info)", icon: "coffee" },
    { label: "Loading Exposure", val: `$${summary.penaltyAud.toFixed(0)}`, sub: "cl 16.6 · today so far", color: "var(--danger)", icon: "banknote" },
  ];

  return (
    <div>
      <PageHead
        title="Break Compliance"
        sub={`${HIGA.awardLabel} · cl 16 — live entitlements from clock-ins, ${fmtClock(now, TZ)}.`}
        right={
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            {modeBadge}
            <LinkBtn href="/reports/breaks">Weekly loading report</LinkBtn>
          </div>
        }
      />

      {(payload?.degraded ?? []).length > 0 && (
        <Card pad={14} style={{ marginBottom: 16, borderColor: "var(--warning)", background: "var(--warning-bg)" }}>
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <Icon name="alert-triangle" size={16} color="var(--warning-fg)" />
            <div style={{ fontSize: 12.5, color: "var(--fg-2)", lineHeight: 1.6 }}>
              <strong>Some award checks are not running.</strong> The Connecteam integration is
              missing permissions, and a check that cannot run looks the same on this board as one
              that passed.
              {(payload?.degraded ?? []).map((d) => (
                <div key={d.scope} style={{ marginTop: 4 }}>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5 }}>{d.scope}</span> — {d.effect}
                </div>
              ))}
            </div>
          </div>
        </Card>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 16, marginBottom: 16 }}>
        {metrics.map((m) => (
          <Card key={m.label} pad={16} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 12.5, color: "var(--fg-3)", fontWeight: 600 }}>{m.label}</span>
              <span style={{ width: 26, height: 26, borderRadius: 7, background: "var(--bg-2)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}><Icon name={m.icon} size={14} color={m.color} /></span>
            </div>
            <span className="fs-tnum" style={{ fontSize: 30, fontWeight: 800, letterSpacing: "-.02em", color: m.label === "Overdue" && summary.overdue ? "var(--danger-fg)" : "var(--fg-1)" }}>{m.val}</span>
            <span style={{ fontSize: 11.5, color: "var(--fg-4)" }}>{m.sub}</span>
          </Card>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "2.2fr 1fr", gap: 16, marginBottom: 16 }}>
        <Card pad={0}>
          <div style={{ padding: "16px 20px", display: "flex", alignItems: "center", gap: 12, borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}>
            <h4 style={{ margin: 0, fontSize: 15.5, flex: 1 }}>Shift Board</h4>
            <div style={{ width: 220 }}><SearchInput value={query} onChange={setQuery} placeholder="Search person, role or site…" /></div>
            <Tabs tabs={FILTERS} value={filter} onChange={setFilter} />
          </div>

          {filtered.length === 0 ? (
            <div style={{ padding: 32, textAlign: "center", fontSize: 13.5, color: "var(--fg-4)" }}>
              {payload ? "Nobody in this view." : "Loading clock-ins…"}
            </div>
          ) : (
            filtered.map((p, i) => {
              const elapsed = p.onShift ? now - p.clockIn : p.elapsedSec;
              const tone: Tone = p.onBreak ? "info" : SEV_TONE[p.severity];
              const label = p.onBreak ? `On ${p.onBreak.kind} break` : SEV_LABEL[p.severity];
              return (
                <div key={p.userId} className="hov-row" onClick={() => setOpenId(p.userId)} style={{ display: "grid", gridTemplateColumns: "230px 1fr 92px 96px", gap: 16, alignItems: "center", padding: "12px 20px", borderTop: i ? "1px solid var(--border)" : 0, cursor: "pointer" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                    <Avatar name={p.name} size={32} ring={p.severity >= 2 && !p.onBreak ? SEV_COLOR[p.severity] : undefined} />
                    <span style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, color: "var(--fg-1)", fontSize: 13.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</div>
                      <div style={{ fontSize: 11, color: "var(--fg-4)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.role}{p.role && " · "}{p.siteName}</div>
                    </span>
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, color: p.severity === 3 ? "var(--danger-fg)" : p.severity === 2 ? "var(--warning-fg)" : "var(--fg-2)", fontWeight: p.severity >= 2 ? 600 : 500, lineHeight: 1.35, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{p.nextAction}</div>
                    <ShiftTimeline p={p} now={now} />
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div className="fs-tnum" style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-.02em", fontFamily: "var(--font-mono)" }}>{fmtDuration(elapsed)}</div>
                    <div style={{ fontSize: 10.5, color: "var(--fg-4)" }}>{fmtClock(p.clockIn, TZ)}{p.plannedEnd ? `–${fmtClock(p.plannedEnd, TZ)}` : " · no roster"}</div>
                  </div>
                  <div style={{ textAlign: "right" }}><Badge tone={tone} dot>{label}</Badge></div>
                </div>
              );
            })
          )}

          <div style={{ padding: "12px 20px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <LinkBtn onClick={() => { setFilter("All"); setQuery(""); }}>Show everyone</LinkBtn>
            <span style={{ fontSize: 12, color: "var(--fg-4)" }}>{filtered.length} of {staff.length} on shift · refreshes every 30s</span>
          </div>
        </Card>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Card>
            <CardHead title="Action Queue" right={<Badge tone={queue.length ? "warning" : "success"} dot>{queue.length ? `${queue.length} waiting` : "Clear"}</Badge>} />
            {queue.length === 0 ? (
              <div style={{ padding: "8px 0", fontSize: 13, color: "var(--fg-4)" }}>Nobody needs a break right now.</div>
            ) : (
              queue.map((p, i) => (
                <div key={p.userId} className="hov-row" onClick={() => setOpenId(p.userId)} style={{ display: "flex", alignItems: "center", gap: 9, padding: "8px 0", borderTop: i ? "1px solid var(--border)" : 0, cursor: "pointer" }}>
                  <Avatar name={p.name} size={26} ring={SEV_COLOR[p.severity]} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</div>
                    <div style={{ fontSize: 11, color: "var(--fg-4)" }}>{p.alerts[0]?.clause ? `cl ${p.alerts[0].clause}` : ""}</div>
                  </span>
                  <span className="fs-tnum" style={{ fontSize: 12.5, fontWeight: 700, color: SEV_COLOR[p.severity] === "var(--danger)" ? "var(--danger-fg)" : "var(--warning-fg)" }}>
                    {p.severity === 3 && p.penalty ? `+${fmtDuration(now - p.penalty.from)}` : p.meal.state === "due_soon" ? `${Math.max(0, Math.ceil((p.meal.deadlineAt - now) / 60))}m` : "due"}
                  </span>
                </div>
              ))
            )}
          </Card>

          <Card>
            <CardHead title="Loading Exposure" right={<span className="fs-tnum" style={{ fontSize: 14, fontWeight: 800, color: accruing.length ? "var(--danger-fg)" : "var(--fg-3)" }}>${summary.penaltyAud.toFixed(2)}</span>} />
            {accruing.length === 0 ? (
              <div style={{ padding: "8px 0", fontSize: 13, color: "var(--fg-4)" }}>No cl 16.6 loading accruing.</div>
            ) : (
              accruing.map((p) => (
                <div key={p.userId} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, padding: "6px 0" }}>
                  <span style={{ color: "var(--fg-2)" }}>{p.name} · since {fmtClock(p.penalty!.from, TZ)}</span>
                  <span className="fs-tnum" style={{ fontWeight: 700, color: "var(--danger-fg)" }}>{p.penalty!.loadingPerHour != null ? `$${(((now - p.penalty!.from) / 3600) * p.penalty!.loadingPerHour).toFixed(2)}` : fmtDuration(now - p.penalty!.from)}</span>
                </div>
              ))
            )}
            <div style={{ marginTop: 10, fontSize: 11.5, color: "var(--fg-4)" }}>+50% of ordinary hourly rate from the 6h mark until the meal break is given (cl 16.5–16.6). Stacks on penalty rates (cl 29.3(c)).</div>
          </Card>

          <Card style={{ background: "var(--fs-teal-tint)", border: "1px solid var(--fs-teal-tint-2)" }}>
            <div style={{ display: "flex", gap: 10 }}>
              <Icon name="shield-check" size={20} color="var(--fs-teal-700)" />
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--fs-teal-700)" }}>Award-verified breaks</div>
                <div style={{ fontSize: 12.5, color: "var(--fs-teal-700)", opacity: 0.85, marginTop: 2 }}>
                  {HIGA.awardId} consolidated to {HIGA.consolidatedTo}. Every break you send from here is written to the hash-chained audit log.
                </div>
              </div>
            </div>
          </Card>
        </div>
      </div>

      {/* Person detail */}
      <Modal
        open={!!active}
        onClose={() => setOpenId(null)}
        title={active ? active.name : ""}
        footer={active ? <Button variant="sec" onClick={() => setOpenId(null)}>Close</Button> : undefined}
      >
        {active && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <Avatar name={active.name} size={44} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 700 }}>{active.name}</div>
                <div style={{ fontSize: 12.5, color: "var(--fg-4)" }}>{active.role}{active.role && " · "}{active.siteName}{active.employmentType ? ` · ${active.employmentType.replace("_", "-")}` : ""}</div>
              </div>
              <Badge tone={active.onBreak ? "info" : SEV_TONE[active.severity]} dot>{active.onBreak ? `On ${active.onBreak.kind} break` : SEV_LABEL[active.severity]}</Badge>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
              <Field label="Clocked in"><div className="fs-tnum" style={{ fontSize: 13.5, fontWeight: 600 }}>{fmtClock(active.clockIn, TZ)}</div></Field>
              <Field label="On shift"><div className="fs-tnum" style={{ fontSize: 13.5, fontWeight: 700 }}>{fmtDuration(now - active.clockIn)}</div></Field>
              <Field label="Table 2 bracket"><div style={{ fontSize: 13.5, fontWeight: 600 }}>{active.bracket.label}{active.plannedEnd ? ` (roster to ${fmtClock(active.plannedEnd, TZ)})` : " (no roster)"}</div></Field>
            </div>

            <div style={{ fontSize: 13, color: active.severity === 3 ? "var(--danger-fg)" : active.severity === 2 ? "var(--warning-fg)" : "var(--fg-2)", fontWeight: active.severity >= 2 ? 600 : 500 }}>{active.nextAction}</div>
            <ShiftTimeline p={active} now={now} />

            <div>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: "var(--fg-4)", marginBottom: 8 }}>Entitlements</div>
              {active.requirements.length === 0 ? (
                <div style={{ fontSize: 13, color: "var(--fg-4)" }}>No break entitlement on a shift this length.</div>
              ) : (
                active.requirements.map((q, i) => (
                  <div key={q.kind} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderTop: i ? "1px solid var(--border)" : 0 }}>
                    <span style={{ flex: 1, fontSize: 13 }}>{q.label} <span style={{ color: "var(--fg-4)", fontSize: 11.5 }}>cl {q.clause}</span></span>
                    <Badge tone={REQ_TONE[q.state] ?? "neutral"} dot>{reqValue(q)}</Badge>
                  </div>
                ))
              )}
            </div>

            {active.penalty && (
              <div style={{ background: "var(--danger-bg)", border: "1px solid #F3C9CB", borderRadius: 12, padding: "10px 12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 12.5, color: "var(--danger-fg)" }}>cl 16.6 loading {active.penalty.accruing ? "accruing" : "owed"} since {fmtClock(active.penalty.from, TZ)}</span>
                <span className="fs-tnum" style={{ fontSize: 13.5, fontWeight: 800, color: "var(--danger-fg)" }}>
                  {fmtDuration(active.penalty.accruing ? now - active.penalty.from : active.penalty.seconds)}
                  {active.penalty.loadingPerHour != null && ` · $${(((active.penalty.accruing ? now - active.penalty.from : active.penalty.seconds) / 3600) * active.penalty.loadingPerHour).toFixed(2)}`}
                </span>
              </div>
            )}

            <div>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: "var(--fg-4)", marginBottom: 8 }}>Actions</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {active.onBreak ? (
                  <Button size="sm" variant="pri" icon="play" style={{ width: "100%", gridColumn: "1 / -1" }} onClick={() => endBreak(active)}>Back on shift</Button>
                ) : (
                  <>
                    <Button size="sm" variant={active.meal.state === "taken" ? "sec" : "pri"} icon="utensils" style={{ width: "100%" }} onClick={() => sendOnBreak(active, "meal")}>Send on meal break</Button>
                    <Button size="sm" variant={active.meal.state === "taken" ? "pri" : "sec"} icon="coffee" style={{ width: "100%" }} onClick={() => sendOnBreak(active, "rest")}>Send on rest break</Button>
                  </>
                )}
              </div>
              <div style={{ fontSize: 11.5, color: "var(--fg-4)", marginTop: 8 }}>Writes a <span style={{ fontFamily: "var(--font-mono)" }}>break.decision</span> event to the Idara audit log.</div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
