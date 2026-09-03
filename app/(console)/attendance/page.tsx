"use client";

import { useMemo, useState } from "react";
import { Card, Spark, Avatar, Badge, Icon, Button, Modal, SearchInput, Tabs, Field, useToast } from "@/components/ui";
import type { Tone } from "@/lib/status";
import { CardHead, LinkBtn, PageHead } from "@/components/screen/page-head";

interface Row {
  person: string;
  role: string;
  rostered: string;
  clockIn: string;
  variance: string;
  varianceTone: Tone | null;
  location: string;
  status: string;
  statusTone: Tone;
}

interface Job {
  job: string;
  planned: string;
  actual: string;
  variance: string;
  cost: string;
  tone: "danger" | "success";
}

const FILTERS = ["All", "On time", "Late", "Absent", "On break"];

const INITIAL_ROWS: Row[] = [
  { person: "Leanne Vidal", role: "Duty Manager", rostered: "7:00am – 3:00pm", clockIn: "7:02am", variance: "+2m", varianceTone: "success", location: "Brightwater Hotel", status: "On time", statusTone: "success" },
  { person: "Liam O'Brien", role: "Barback", rostered: "7:00am – 3:00pm", clockIn: "7:18am", variance: "+18m", varianceTone: "warning", location: "Brightwater Hotel", status: "Late", statusTone: "warning" },
  { person: "Hassan Ali", role: "Head Chef", rostered: "6:30am – 3:00pm", clockIn: "6:28am", variance: "–2m", varianceTone: "success", location: "Brightwater Hotel", status: "On time", statusTone: "success" },
  { person: "Tahlia Johnson", role: "Wait Staff", rostered: "11:00am – 7:00pm", clockIn: "—", variance: "—", varianceTone: null, location: "Brightwater Hotel", status: "Absent", statusTone: "danger" },
  { person: "Priya Sharma", role: "Events Coordinator", rostered: "11:00am – 7:00pm", clockIn: "11:05am", variance: "+5m", varianceTone: "success", location: "Brightwater Hotel", status: "On time", statusTone: "success" },
  { person: "Sophie Nguyen", role: "Venue Manager", rostered: "11:00am – 7:00pm", clockIn: "11:00am", variance: "On time", varianceTone: "success", location: "Northside Tavern", status: "On time", statusTone: "success" },
  { person: "Darie Roberts", role: "Bartender", rostered: "4:00pm – 12:00am", clockIn: "On break", variance: "8:15pm", varianceTone: "info", location: "Brightwater Hotel", status: "Break", statusTone: "info" },
  { person: "Mitch Egan", role: "Gaming Attendant", rostered: "4:00pm – 12:00am", clockIn: "4:11pm", variance: "+11m", varianceTone: "warning", location: "Brightwater Gaming Room", status: "Late", statusTone: "warning" },
];

const SPARKS: Record<string, number[]> = {
  "On Shift": [3, 4, 4, 5, 6, 5, 6],
  Late: [1, 2, 1, 3, 2, 3, 2],
  Absent: [2, 1, 2, 1, 1, 2, 1],
  Overtime: [1, 2, 3, 2, 4, 3, 4],
  "Breaks Due": [2, 3, 2, 3, 2, 3, 4],
};

const JOBS: Job[] = [
  { job: "Brightwater Friday Live", planned: "1,280", actual: "1,356", variance: "+76h", cost: "+$8,420", tone: "danger" },
  { job: "Northside Long Lunch", planned: "960", actual: "912", variance: "–48h", cost: "–$5,210", tone: "success" },
  { job: "Werribee Park Wedding", planned: "1,150", actual: "1,102", variance: "–48h", cost: "–$4,780", tone: "success" },
  { job: "Docklands Corporate Lunch", planned: "640", actual: "678", variance: "+38h", cost: "+$3,150", tone: "danger" },
  { job: "Quayside Product Launch", planned: "820", actual: "809", variance: "–11h", cost: "–$920", tone: "success" },
];

const JOB_DETAIL: Record<string, [string, string][]> = {
  "Brightwater Friday Live": [["Bar staffing", "+34h"], ["Security", "+22h"], ["Late-night loading", "+12h"], ["Overtime", "+8h"]],
  "Northside Long Lunch": [["Kitchen prep", "–28h"], ["Floor staff", "–14h"], ["Early finish", "–6h"]],
  "Werribee Park Wedding": [["Travel & bump-in", "–26h"], ["Kitchen brigade", "–12h"], ["Scheduling gains", "–10h"]],
  "Docklands Corporate Lunch": [["Wait staff", "+20h"], ["Menu variations", "+11h"], ["Overtime loading", "+7h"]],
  "Quayside Product Launch": [["Canape service", "–6h"], ["General floor", "–5h"]],
};

const varianceColor = (tone: Tone | null) =>
  tone === "success" ? "var(--success-fg)" : tone === "warning" ? "var(--warning-fg)" : tone === "info" ? "var(--info-fg)" : "var(--fg-4)";

function nowTime() {
  const d = new Date();
  let h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, "0");
  const ampm = h >= 12 ? "pm" : "am";
  h = h % 12 || 12;
  return `${h}:${m}${ampm}`;
}

export default function AttendancePage() {
  const toast = useToast();
  const [filter, setFilter] = useState("All");
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<Row[]>(INITIAL_ROWS);
  const [openPerson, setOpenPerson] = useState<string | null>(null);
  const [lateOpen, setLateOpen] = useState(false);
  const [openJob, setOpenJob] = useState<string | null>(null);

  // Derive the 5 top metric counts from row state.
  const metrics = useMemo(() => {
    const onShift = rows.filter((r) => r.status === "On time" || r.status === "Late" || r.status === "Break").length;
    const late = rows.filter((r) => r.status === "Late").length;
    const absent = rows.filter((r) => r.status === "Absent").length;
    const overtime = rows.filter((r) => r.status === "Overtime").length;
    const breaks = rows.filter((r) => r.status === "Break").length;
    const rostered = rows.length;
    const pct = (n: number) => `${Math.round((n / rostered) * 100)}% of rostered`;
    return [
      { label: "On Shift", val: String(onShift), sub: pct(onShift), color: "var(--success)", icon: "users" },
      { label: "Late", val: String(late), sub: pct(late), color: "var(--warning)", icon: "clock" },
      { label: "Absent", val: String(absent), sub: pct(absent), color: "var(--danger)", icon: "user-x" },
      { label: "Overtime", val: String(overtime), sub: `${overtime} in overtime`, color: "var(--info)", icon: "timer" },
      { label: "Breaks Due", val: String(breaks), sub: "Currently on break", color: "var(--series-violet)", icon: "coffee" },
    ];
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      const matchStatus =
        filter === "All" ||
        (filter === "On time" && r.status === "On time") ||
        (filter === "Late" && r.status === "Late") ||
        (filter === "Absent" && r.status === "Absent") ||
        (filter === "On break" && r.status === "Break");
      const matchQuery = !q || r.person.toLowerCase().includes(q) || r.role.toLowerCase().includes(q);
      return matchStatus && matchQuery;
    });
  }, [rows, filter, query]);

  const lateRows = useMemo(() => rows.filter((r) => r.status === "Late"), [rows]);
  const active = openPerson ? rows.find((r) => r.person === openPerson) ?? null : null;
  const activeJob = openJob ? JOBS.find((j) => j.job === openJob) ?? null : null;

  function mutate(person: string, patch: Partial<Row>, msg: string, tone: Tone, icon: string) {
    setRows((list) => list.map((r) => (r.person === person ? { ...r, ...patch } : r)));
    toast(msg, { tone, icon });
  }

  function clockIn(person: string) {
    const t = nowTime();
    mutate(person, { clockIn: t, variance: "On time", varianceTone: "success", status: "On time", statusTone: "success" }, `${person} clocked in at ${t}`, "success", "log-in");
  }
  function clockOut(person: string) {
    mutate(person, { status: "On time", statusTone: "neutral", variance: "Shift ended", varianceTone: null }, `${person} clocked out`, "neutral", "log-out");
  }
  function startBreak(person: string) {
    const t = nowTime();
    mutate(person, { clockIn: "On break", variance: t, varianceTone: "info", status: "Break", statusTone: "info" }, `${person} started a break`, "info", "coffee");
  }
  function endBreak(person: string) {
    const t = nowTime();
    mutate(person, { clockIn: t, variance: "Back on shift", varianceTone: "success", status: "On time", statusTone: "success" }, `${person} ended break`, "success", "play");
  }
  function markAbsent(person: string) {
    mutate(person, { clockIn: "—", variance: "—", varianceTone: null, status: "Absent", statusTone: "danger" }, `${person} marked absent`, "danger", "user-x");
  }
  function flag(person: string) {
    mutate(person, { variance: "Flagged", varianceTone: "warning", status: "Late", statusTone: "warning" }, `${person} flagged for review`, "warning", "flag");
  }

  const actionBtnStyle = { width: "100%" } as const;

  return (
    <div>
      <PageHead title="Live Attendance" sub="Real-time attendance across people, venues and shifts." right={<Badge tone="success" dot>Live</Badge>} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 16, marginBottom: 16 }}>
        {metrics.map((m) => (
          <Card key={m.label} pad={16} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 12.5, color: "var(--fg-3)", fontWeight: 600 }}>{m.label}</span>
              <span style={{ width: 26, height: 26, borderRadius: 7, background: "var(--bg-2)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}><Icon name={m.icon} size={14} color={m.color} /></span>
            </div>
            <span className="fs-tnum" style={{ fontSize: 30, fontWeight: 800, letterSpacing: "-.02em" }}>{m.val}</span>
            <span style={{ fontSize: 11.5, color: "var(--fg-4)" }}>{m.sub}</span>
            <div style={{ marginTop: 4 }}><Spark data={SPARKS[m.label]} color={m.color} width={150} height={26} /></div>
          </Card>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "2.2fr 1fr", gap: 16, marginBottom: 16 }}>
        <Card pad={0}>
          <div style={{ padding: "16px 20px", display: "flex", alignItems: "center", gap: 12, borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}>
            <h4 style={{ margin: 0, fontSize: 15.5, flex: 1 }}>Live Attendance</h4>
            <div style={{ width: 220 }}>
              <SearchInput value={query} onChange={setQuery} placeholder="Search person or role…" />
            </div>
            <Tabs tabs={FILTERS} value={filter} onChange={setFilter} />
          </div>
          <table className="fs-tnum" style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr>
                {["Person", "Rostered", "Clock In", "Variance", "Location", "Status"].map((h) => (
                  <th key={h} style={{ textAlign: "left", fontSize: 11, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: "var(--fg-4)", padding: "10px 16px" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.person} onClick={() => setOpenPerson(r.person)} style={{ borderTop: "1px solid var(--border)", cursor: "pointer" }} className="hov-row">
                  <td style={{ padding: "11px 16px" }}><div style={{ display: "flex", alignItems: "center", gap: 9 }}><Avatar name={r.person} size={28} /><span><div style={{ fontWeight: 600, color: "var(--fg-1)" }}>{r.person}</div><div style={{ fontSize: 11, color: "var(--fg-4)" }}>{r.role}</div></span></div></td>
                  <td style={{ padding: "11px 16px", color: "var(--fg-2)" }}>{r.rostered}</td>
                  <td style={{ padding: "11px 16px", color: "var(--fg-2)" }}>{r.clockIn}</td>
                  <td style={{ padding: "11px 16px", fontWeight: 600, color: varianceColor(r.varianceTone) }}>{r.variance}</td>
                  <td style={{ padding: "11px 16px", color: "var(--fg-2)" }}><span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><Icon name="map-pin" size={13} color="var(--fg-4)" />{r.location}</span></td>
                  <td style={{ padding: "11px 16px" }}><Badge tone={r.statusTone} dot>{r.status}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ padding: "12px 16px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <LinkBtn onClick={() => { setFilter("All"); setQuery(""); }}>View all attendance</LinkBtn>
            <span style={{ fontSize: 12, color: "var(--fg-4)" }}>{filtered.length} of {rows.length} rostered</span>
          </div>
        </Card>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Card>
            <CardHead title="Late Clock-ins" right={<LinkBtn onClick={() => setLateOpen(true)}>View all</LinkBtn>} />
            {lateRows.length === 0 ? (
              <div style={{ padding: "12px 0", fontSize: 13, color: "var(--fg-4)" }}>No late clock-ins right now.</div>
            ) : (
              lateRows.map((r, i) => (
                <div key={r.person} onClick={() => setOpenPerson(r.person)} className="hov-row" style={{ display: "flex", alignItems: "center", gap: 9, padding: "7px 0", borderTop: i ? "1px solid var(--border)" : 0, cursor: "pointer" }}>
                  <Avatar name={r.person} size={26} /><span style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>{r.person}</span>
                  <span className="fs-tnum" style={{ fontSize: 12.5, color: "var(--fg-3)" }}>{r.clockIn}</span>
                  <span className="fs-tnum" style={{ fontSize: 12.5, fontWeight: 700, color: "var(--warning-fg)" }}>{r.variance}</span>
                </div>
              ))
            )}
          </Card>
          <Card style={{ background: "var(--fs-teal-tint)", border: "1px solid var(--fs-teal-tint-2)" }}>
            <div style={{ display: "flex", gap: 10 }}>
              <Icon name="shield-check" size={20} color="var(--fs-teal-700)" />
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--fs-teal-700)" }}>Verified Attendance</div>
                <div style={{ fontSize: 12.5, color: "var(--fs-teal-700)", opacity: 0.85, marginTop: 2 }}>GPS, geofence and identity verification active.</div>
              </div>
            </div>
          </Card>
        </div>
      </div>
      <Card>
        <CardHead title="Job Profitability (Labour Cost vs Plan)" right={<LinkBtn>View full labour cost report</LinkBtn>} />
        <table className="fs-tnum" style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr>
              {["Job", "Planned Hours", "Actual Hours", "Variance", "Labour Cost Variance"].map((h, i) => (
                <th key={h} style={{ textAlign: i ? "right" : "left", fontSize: 11, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: "var(--fg-4)", padding: "8px 8px" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {JOBS.map((j) => (
              <tr key={j.job} onClick={() => setOpenJob(j.job)} className="hov-row" style={{ borderTop: "1px solid var(--border)", cursor: "pointer" }}>
                <td style={{ padding: "11px 8px", fontWeight: 600, color: "var(--fg-1)" }}>{j.job}</td>
                <td style={{ padding: "11px 8px", textAlign: "right", color: "var(--fg-2)" }}>{j.planned}h</td>
                <td style={{ padding: "11px 8px", textAlign: "right", color: "var(--fg-2)" }}>{j.actual}h</td>
                <td style={{ padding: "11px 8px", textAlign: "right", fontWeight: 600, color: j.tone === "danger" ? "var(--danger-fg)" : "var(--success-fg)" }}>{j.variance}</td>
                <td style={{ padding: "11px 8px", textAlign: "right", fontWeight: 700, color: j.tone === "danger" ? "var(--danger-fg)" : "var(--success-fg)" }}>{j.cost}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {/* Person detail modal */}
      <Modal
        open={!!active}
        onClose={() => setOpenPerson(null)}
        title={active ? active.person : ""}
        footer={active ? <Button variant="sec" onClick={() => setOpenPerson(null)}>Close</Button> : undefined}
      >
        {active && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <Avatar name={active.person} size={44} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: "var(--fg-1)" }}>{active.person}</div>
                <div style={{ fontSize: 12.5, color: "var(--fg-4)" }}>{active.role}</div>
              </div>
              <Badge tone={active.statusTone} dot>{active.status}</Badge>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="Rostered"><div style={{ fontSize: 13.5, color: "var(--fg-1)", fontWeight: 600 }}>{active.rostered}</div></Field>
              <Field label="Location"><div style={{ fontSize: 13.5, color: "var(--fg-1)", fontWeight: 600 }}>{active.location}</div></Field>
              <Field label="Clock In"><div className="fs-tnum" style={{ fontSize: 13.5, color: "var(--fg-1)", fontWeight: 600 }}>{active.clockIn}</div></Field>
              <Field label="Variance"><div className="fs-tnum" style={{ fontSize: 13.5, fontWeight: 700, color: varianceColor(active.varianceTone) }}>{active.variance}</div></Field>
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: "var(--fg-4)", marginBottom: 8 }}>Actions</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <Button size="sm" variant="pri" icon="log-in" style={actionBtnStyle} onClick={() => clockIn(active.person)}>Clock In</Button>
                <Button size="sm" variant="sec" icon="log-out" style={actionBtnStyle} onClick={() => clockOut(active.person)}>Clock Out</Button>
                {active.status === "Break" ? (
                  <Button size="sm" variant="sec" icon="play" style={actionBtnStyle} onClick={() => endBreak(active.person)}>End Break</Button>
                ) : (
                  <Button size="sm" variant="sec" icon="coffee" style={actionBtnStyle} onClick={() => startBreak(active.person)}>Start Break</Button>
                )}
                <Button size="sm" variant="sec" icon="flag" style={actionBtnStyle} onClick={() => flag(active.person)}>Flag</Button>
                <Button size="sm" variant="danger" icon="user-x" style={{ ...actionBtnStyle, gridColumn: "1 / -1" }} onClick={() => markAbsent(active.person)}>Mark Absent</Button>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* Late clock-ins modal */}
      <Modal open={lateOpen} onClose={() => setLateOpen(false)} title="Late Clock-ins" size="sm">
        {lateRows.length === 0 ? (
          <div style={{ fontSize: 13.5, color: "var(--fg-3)" }}>No late clock-ins right now.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {lateRows.map((r, i) => (
              <div
                key={r.person}
                className="hov-row"
                onClick={() => { setLateOpen(false); setOpenPerson(r.person); }}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 4px", borderTop: i ? "1px solid var(--border)" : 0, cursor: "pointer" }}
              >
                <Avatar name={r.person} size={30} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--fg-1)" }}>{r.person}</div>
                  <div style={{ fontSize: 11.5, color: "var(--fg-4)" }}>{r.role}</div>
                </div>
                <span className="fs-tnum" style={{ fontSize: 12.5, color: "var(--fg-3)" }}>{r.clockIn}</span>
                <span className="fs-tnum" style={{ fontSize: 12.5, fontWeight: 700, color: "var(--warning-fg)" }}>{r.variance}</span>
              </div>
            ))}
          </div>
        )}
      </Modal>

      {/* Job profitability breakdown modal */}
      <Modal open={!!activeJob} onClose={() => setOpenJob(null)} title={activeJob ? activeJob.job : ""}>
        {activeJob && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
              <Field label="Planned"><div className="fs-tnum" style={{ fontSize: 15, fontWeight: 700, color: "var(--fg-1)" }}>{activeJob.planned}h</div></Field>
              <Field label="Actual"><div className="fs-tnum" style={{ fontSize: 15, fontWeight: 700, color: "var(--fg-1)" }}>{activeJob.actual}h</div></Field>
              <Field label="Cost Variance"><div className="fs-tnum" style={{ fontSize: 15, fontWeight: 700, color: activeJob.tone === "danger" ? "var(--danger-fg)" : "var(--success-fg)" }}>{activeJob.cost}</div></Field>
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: "var(--fg-4)", marginBottom: 8 }}>Hours Variance Breakdown</div>
              <div style={{ display: "flex", flexDirection: "column" }}>
                {(JOB_DETAIL[activeJob.job] ?? []).map(([label, val], i) => {
                  const up = val.startsWith("+");
                  return (
                    <div key={label} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderTop: i ? "1px solid var(--border)" : 0 }}>
                      <Icon name={up ? "trending-up" : "trending-down"} size={15} color={up ? "var(--danger-fg)" : "var(--success-fg)"} />
                      <span style={{ flex: 1, fontSize: 13.5, color: "var(--fg-2)" }}>{label}</span>
                      <span className="fs-tnum" style={{ fontSize: 13, fontWeight: 700, color: up ? "var(--danger-fg)" : "var(--success-fg)" }}>{val}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
