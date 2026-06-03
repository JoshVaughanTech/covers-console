"use client";

import type { ReactNode } from "react";
import { Card, Ring, Bar, Spark, Avatar, AvatarStack, Badge, Icon, STATUS } from "@/components/ui";
import type { Tone } from "@/lib/status";
import { PageHead, CardHead, LinkBtn } from "@/components/screen/page-head";

interface Metric {
  label: string;
  value: string;
  status: string;
  statusTone: string;
  link: string;
  href: string;
  icon: string;
  accent: string | null;
}

interface Activity {
  icon: string;
  tone: Tone;
  text: ReactNode;
  meta: string;
  t: string;
}

export default function OverviewPage() {
  const metrics: Metric[] = [
    { label: "Open Job Rooms", value: "7", status: "Active", statusTone: "var(--fg-3)", link: "View all jobs", href: "/jobs", icon: "briefcase", accent: null },
    { label: "Credential Alerts", value: "3", status: "Require attention", statusTone: "var(--fg-3)", link: "View alerts", href: "/credentials", icon: "shield-alert", accent: "var(--danger)" },
    { label: "Project Tasks", value: "64", status: "In progress", statusTone: "var(--fg-3)", link: "View projects", href: "/projects", icon: "list-checks", accent: null },
  ];
  const heat: [string, number[]][] = [
    ["Brisbane", [1, 2, 3, 4, 5, 4, 3]],
    ["Sydney", [2, 3, 4, 5, 6, 5, 3]],
    ["Melbourne", [1, 2, 4, 6, 6, 4, 2]],
    ["Perth", [0, 1, 2, 3, 4, 3, 2]],
    ["Adelaide", [0, 1, 1, 2, 3, 2, 1]],
  ];
  const viz = ["#ECF6F4", "#CDEAE4", "#A3DAD0", "#6CC6B8", "#2FA897", "#0D8B82", "#075A54"];
  const activity: Activity[] = [
    { icon: "log-in", tone: "success", text: <><b>James Carter</b> clocked in at 7:02am</>, meta: "Commercial Build – Level 3", t: "2m ago" },
    { icon: "message-square-plus", tone: "info", text: <>New job room <b>&quot;Brisbane Warehouse&quot;</b> created by Sarah Lee</>, meta: "", t: "15m ago" },
    { icon: "shield-alert", tone: "danger", text: <>Credential alert: 2 workers require action</>, meta: "", t: "32m ago" },
    { icon: "file-check-2", tone: "teal", text: <>Weekly fairness report is ready to view</>, meta: "", t: "1h ago" },
  ];
  const projects: [string, string, number, string][] = [
    ["Riverside Apartments", "Construction", 72, "var(--success)"],
    ["Harbour View Offices", "Fitout", 48, "var(--warning)"],
    ["Airport Terminal Upgrade", "Refurbishment", 81, "var(--success)"],
    ["Sunnybank Retail Precinct", "Construction", 36, "var(--danger)"],
  ];
  const fairness: [string, number][] = [
    ["Alex Nguyen", 96],
    ["Mia Anderson", 94],
    ["Jordan Lee", 93],
    ["Taylor Wilson", 92],
    ["Casey Brown", 90],
  ];
  const upcoming: [string, string, string[], number][] = [
    ["Today · 9:00am – 5:00pm", "Commercial Build – Level 3", ["Ana Reed", "Ben Cole", "Cara Vu"], 6],
    ["Tomorrow · 7:00am – 3:00pm", "Fitout – Tower B", ["Dan Fox", "Eve Ho"], 4],
    ["Wed 15 May · 8:00am – 4:00pm", "Maintenance – Site Wide", ["Gus Ray", "Hana Lim"], 3],
  ];

  return (
    <div>
      <PageHead title="Good morning, Emma! 👋" sub="Here's what's happening across your operations." />
      {/* top metric row */}
      <div style={{ display: "grid", gridTemplateColumns: "1.15fr 1.15fr repeat(3,1fr)", gap: 16, marginBottom: 16 }}>
        <Card pad={18} style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 13, color: "var(--fg-3)", fontWeight: 600, marginBottom: 8 }}>Roster Fairness Score</div>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <Ring value={88} label="88%" size={84} />
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "var(--success-fg)" }}>Very Good</div>
              <div style={{ fontSize: 12, color: "var(--success-fg)", marginTop: 4 }}>↑ 6pp vs last 7 days</div>
            </div>
          </div>
        </Card>
        <Card pad={18} style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 13, color: "var(--fg-3)", fontWeight: 600, marginBottom: 8 }}>Live Attendance</div>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <Ring value={88} label="142" sub="/ 168" size={84} color="var(--success)" />
            <div style={{ fontSize: 12.5, display: "flex", flexDirection: "column", gap: 5 }}>
              <span style={{ display: "flex", justifyContent: "space-between", gap: 14 }}><span style={{ color: "var(--fg-2)" }}><span style={{ color: "var(--success)" }}>●</span> On Shift</span><b className="fs-tnum">112</b></span>
              <span style={{ display: "flex", justifyContent: "space-between", gap: 14 }}><span style={{ color: "var(--fg-2)" }}><span style={{ color: "var(--warning)" }}>●</span> Late</span><b className="fs-tnum">8</b></span>
              <span style={{ display: "flex", justifyContent: "space-between", gap: 14 }}><span style={{ color: "var(--fg-2)" }}><span style={{ color: "var(--danger)" }}>●</span> Absent</span><b className="fs-tnum">22</b></span>
            </div>
          </div>
        </Card>
        {metrics.map((m, i) => (
          <Card key={i} pad={18} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <span style={{ fontSize: 13, color: "var(--fg-3)", fontWeight: 600 }}>{m.label}</span>
              <Icon name={m.icon} size={17} color={m.accent || "var(--fg-4)"} />
            </div>
            <span className="fs-tnum" style={{ fontSize: 32, fontWeight: 800, letterSpacing: "-.02em" }}>{m.value}</span>
            <span style={{ fontSize: 12.5, color: m.statusTone }}>{m.status}</span>
            <div style={{ marginTop: 6 }}><LinkBtn href={m.href}>{m.link}</LinkBtn></div>
          </Card>
        ))}
      </div>
      {/* mid row */}
      <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1.4fr 1.3fr", gap: 16, marginBottom: 16 }}>
        <Card>
          <CardHead title="Fairness Trend" right={<Badge tone="neutral">Last 4 weeks</Badge>} />
          <div style={{ position: "relative", height: 130 }}>
            <Spark data={[52, 58, 55, 63, 60, 68, 74, 88]} width={300} height={120} />
            <span style={{ position: "absolute", top: 0, right: 0, background: "var(--fs-teal)", color: "#fff", fontSize: 12, fontWeight: 700, padding: "3px 8px", borderRadius: 6 }}>88%</span>
          </div>
        </Card>
        <Card>
          <CardHead title="Attendance Heatmap (Today)" />
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {heat.map(([city, vals]) => (
              <div key={city} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ width: 64, fontSize: 12, color: "var(--fg-3)" }}>{city}</span>
                <div style={{ display: "flex", gap: 4, flex: 1 }}>
                  {vals.map((v, i) => <div key={i} style={{ flex: 1, height: 16, borderRadius: 4, background: viz[v] }} />)}
                </div>
              </div>
            ))}
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4, fontSize: 11, color: "var(--fg-4)" }}>
              Low {viz.map((c, i) => <span key={i} style={{ width: 14, height: 10, borderRadius: 2, background: c }} />)} High
            </div>
          </div>
        </Card>
        <Card>
          <CardHead title="Upcoming Shifts" right={<LinkBtn href="/schedule">View full schedule</LinkBtn>} />
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {upcoming.map(([t, p, names, ex], i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--fg-1)" }}>{t}</div>
                  <div style={{ fontSize: 12, color: "var(--fg-3)" }}>{p}</div>
                </div>
                <AvatarStack names={names} size={26} extra={ex} />
              </div>
            ))}
          </div>
        </Card>
      </div>
      {/* bottom row */}
      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1.2fr 1.1fr", gap: 16 }}>
        <Card>
          <CardHead title="Recent Activity" />
          <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
            {activity.map((a, i) => {
              const [bg, fg] = STATUS[a.tone];
              return (
                <div key={i} style={{ display: "flex", gap: 11 }}>
                  <span style={{ width: 30, height: 30, borderRadius: 8, background: bg, color: fg, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Icon name={a.icon} size={16} /></span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, color: "var(--fg-2)", lineHeight: 1.4 }}>{a.text}</div>
                    {a.meta && <div style={{ fontSize: 11.5, color: "var(--fg-4)" }}>{a.meta}</div>}
                  </div>
                  <span style={{ fontSize: 11.5, color: "var(--fg-4)", whiteSpace: "nowrap" }}>{a.t}</span>
                </div>
              );
            })}
          </div>
        </Card>
        <Card>
          <CardHead title="Project Overview" right={<LinkBtn href="/projects">View all</LinkBtn>} />
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {projects.map(([n, t, v, c], i) => (
              <div key={i}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                  <div><div style={{ fontSize: 13, fontWeight: 600, color: "var(--fg-1)" }}>{n}</div><div style={{ fontSize: 11.5, color: "var(--fg-4)" }}>{t}</div></div>
                  <span className="fs-tnum" style={{ fontSize: 13, fontWeight: 700 }}>{v}%</span>
                </div>
                <Bar value={v} color={c} />
              </div>
            ))}
          </div>
        </Card>
        <Card>
          <CardHead title="Top Fairness Contributors" right={<Badge tone="neutral">This week</Badge>} />
          <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
            {fairness.map(([n, v], i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ width: 16, fontSize: 12, fontWeight: 700, color: "var(--fg-4)" }}>{i + 1}</span>
                <Avatar name={n} size={26} />
                <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: "var(--fg-1)" }}>{n}</span>
                <span className="fs-tnum" style={{ fontSize: 13, fontWeight: 700, color: "var(--success-fg)" }}>{v}%</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
