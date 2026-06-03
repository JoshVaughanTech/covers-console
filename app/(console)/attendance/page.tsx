"use client";

import { useState } from "react";
import { Card, Spark, Avatar, Badge, Icon } from "@/components/ui";
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

export default function AttendancePage() {
  const [filter, setFilter] = useState("All");
  const top: [string, string, string, string, string, number[]][] = [
    ["On Shift", "142", "74% of rostered", "var(--success)", "users", [3, 4, 4, 5, 6, 5, 6]],
    ["Late", "18", "9% of rostered", "var(--warning)", "clock", [1, 2, 1, 3, 2, 3, 2]],
    ["Absent", "12", "6% of rostered", "var(--danger)", "user-x", [2, 1, 2, 1, 1, 2, 1]],
    ["Overtime", "24", "12h 45m today", "var(--info)", "timer", [1, 2, 3, 2, 4, 3, 4]],
    ["Breaks Due", "11", "Due within 30m", "var(--series-violet)", "coffee", [2, 3, 2, 3, 2, 3, 4]],
  ];
  const rows: Row[] = [
    { person: "Darie Roberts", role: "Carpenter", rostered: "7:00am – 3:30pm", clockIn: "7:02am", variance: "+2m", varianceTone: "success", location: "Melbourne Site", status: "On time", statusTone: "success" },
    { person: "Leanne Vidal", role: "Electrician", rostered: "7:00am – 3:30pm", clockIn: "7:18am", variance: "+18m", varianceTone: "warning", location: "Melbourne Site", status: "Late", statusTone: "warning" },
    { person: "Mitch Egan", role: "Concreter", rostered: "6:30am – 3:00pm", clockIn: "6:28am", variance: "–2m", varianceTone: "success", location: "Melbourne Site", status: "On time", statusTone: "success" },
    { person: "Tahlia Johnson", role: "Labourer", rostered: "7:00am – 3:30pm", clockIn: "—", variance: "—", varianceTone: null, location: "Melbourne Site", status: "Absent", statusTone: "danger" },
    { person: "Aaron Patel", role: "Carpenter", rostered: "7:00am – 3:30pm", clockIn: "7:05am", variance: "+5m", varianceTone: "success", location: "Melbourne Site", status: "On time", statusTone: "success" },
    { person: "Sophie Nguyen", role: "Supervisor", rostered: "7:00am – 3:30pm", clockIn: "7:00am", variance: "On time", varianceTone: "success", location: "Port Melbourne", status: "On time", statusTone: "success" },
    { person: "Jake Morrison", role: "Carpenter", rostered: "7:00am – 3:30pm", clockIn: "On break", variance: "10:15am", varianceTone: "info", location: "Melbourne Site", status: "Break", statusTone: "info" },
    { person: "Hassan Ali", role: "Steel Fixer", rostered: "7:00am – 3:30pm", clockIn: "7:11am", variance: "+11m", varianceTone: "warning", location: "Melbourne Site", status: "Late", statusTone: "warning" },
  ];
  const filtered = rows.filter(
    (r) =>
      filter === "All" ||
      (filter === "On time" && r.status === "On time") ||
      (filter === "Late" && r.status === "Late") ||
      (filter === "Absent" && r.status === "Absent") ||
      (filter === "On break" && r.status === "Break"),
  );
  const jobs: [string, string, string, string, string, "danger" | "success"][] = [
    ["Commercial Build – Level 2", "1,280", "1,356", "+76h", "+$8,420", "danger"],
    ["Warehouse – Stage 1", "960", "912", "–48h", "–$5,210", "success"],
    ["Aged Care Facility", "1,150", "1,102", "–48h", "–$4,780", "success"],
    ["Retail Fitout – Store 34", "640", "678", "+38h", "+$3,150", "danger"],
    ["Civic Centre Upgrade", "820", "809", "–11h", "–$920", "success"],
  ];

  const varianceColor = (tone: Tone | null) =>
    tone === "success" ? "var(--success-fg)" : tone === "warning" ? "var(--warning-fg)" : tone === "info" ? "var(--info-fg)" : "var(--fg-4)";

  return (
    <div>
      <PageHead title="Live Attendance" sub="Real-time attendance across people, sites and shifts." right={<Badge tone="success" dot>Live</Badge>} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 16, marginBottom: 16 }}>
        {top.map(([label, val, sub, color, icon, spark], i) => (
          <Card key={i} pad={16} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 12.5, color: "var(--fg-3)", fontWeight: 600 }}>{label}</span>
              <span style={{ width: 26, height: 26, borderRadius: 7, background: "var(--bg-2)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}><Icon name={icon} size={14} color={color} /></span>
            </div>
            <span className="fs-tnum" style={{ fontSize: 30, fontWeight: 800, letterSpacing: "-.02em" }}>{val}</span>
            <span style={{ fontSize: 11.5, color: "var(--fg-4)" }}>{sub}</span>
            <div style={{ marginTop: 4 }}><Spark data={spark} color={color} width={150} height={26} /></div>
          </Card>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "2.2fr 1fr", gap: 16, marginBottom: 16 }}>
        <Card pad={0}>
          <div style={{ padding: "16px 20px", display: "flex", alignItems: "center", gap: 12, borderBottom: "1px solid var(--border)" }}>
            <h4 style={{ margin: 0, fontSize: 15.5, flex: 1 }}>Live Attendance</h4>
            <div style={{ display: "inline-flex", background: "var(--bg-2)", borderRadius: 9, padding: 3, gap: 2 }}>
              {["All", "On time", "Late", "Absent", "On break"].map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  style={{
                    border: 0,
                    font: "inherit",
                    fontSize: 12.5,
                    fontWeight: 600,
                    padding: "6px 11px",
                    borderRadius: 7,
                    cursor: "pointer",
                    background: filter === f ? "#fff" : "transparent",
                    color: filter === f ? "var(--fg-1)" : "var(--fg-3)",
                    boxShadow: filter === f ? "var(--shadow-xs)" : "none",
                  }}
                >
                  {f}
                </button>
              ))}
            </div>
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
              {filtered.map((r, i) => (
                <tr key={i} style={{ borderTop: "1px solid var(--border)" }} className="hov-row">
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
            <LinkBtn>View all attendance</LinkBtn>
            <span style={{ fontSize: 12, color: "var(--fg-4)" }}>{filtered.length} of 192 rostered</span>
          </div>
        </Card>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Card>
            <CardHead title="Late Clock-ins" right={<LinkBtn>View all</LinkBtn>} />
            {([["Leanne Vidal", "7:18am", "+18m"], ["Hassan Ali", "7:11am", "+11m"], ["Josh Williams", "7:09am", "+9m"], ["Michael Tan", "7:07am", "+7m"]] as [string, string, string][]).map(([n, t, v], i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 9, padding: "7px 0", borderTop: i ? "1px solid var(--border)" : 0 }}>
                <Avatar name={n} size={26} /><span style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>{n}</span>
                <span className="fs-tnum" style={{ fontSize: 12.5, color: "var(--fg-3)" }}>{t}</span>
                <span className="fs-tnum" style={{ fontSize: 12.5, fontWeight: 700, color: "var(--warning-fg)" }}>{v}</span>
              </div>
            ))}
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
            {jobs.map((j, i) => (
              <tr key={i} style={{ borderTop: "1px solid var(--border)" }}>
                <td style={{ padding: "11px 8px", fontWeight: 600, color: "var(--fg-1)" }}>{j[0]}</td>
                <td style={{ padding: "11px 8px", textAlign: "right", color: "var(--fg-2)" }}>{j[1]}h</td>
                <td style={{ padding: "11px 8px", textAlign: "right", color: "var(--fg-2)" }}>{j[2]}h</td>
                <td style={{ padding: "11px 8px", textAlign: "right", fontWeight: 600, color: j[5] === "danger" ? "var(--danger-fg)" : "var(--success-fg)" }}>{j[3]}</td>
                <td style={{ padding: "11px 8px", textAlign: "right", fontWeight: 700, color: j[5] === "danger" ? "var(--danger-fg)" : "var(--success-fg)" }}>{j[4]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
