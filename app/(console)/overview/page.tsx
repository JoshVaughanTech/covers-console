"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Card, Ring, Bar, Spark, Avatar, AvatarStack, Icon, Tabs, STATUS } from "@/components/ui";
import { useToast } from "@/components/ui";
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
  href: string;
  toast: string;
}

/* Clickable card wrapper: cursor pointer + soft hover lift, routes on click. */
function ClickableCard({
  pad,
  style,
  onClick,
  ariaLabel,
  children,
}: {
  pad?: number;
  style?: CSSProperties;
  onClick: () => void;
  ariaLabel: string;
  children: ReactNode;
}) {
  const [hover, setHover] = useState(false);
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={ariaLabel}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ cursor: "pointer", outline: "none" }}
    >
      <Card
        pad={pad}
        style={{
          transition: "transform .15s, box-shadow .15s, border-color .15s",
          transform: hover ? "translateY(-2px)" : "none",
          boxShadow: hover ? "var(--shadow-md)" : "var(--shadow-card)",
          borderColor: hover ? "var(--fs-teal)" : "var(--border)",
          ...style,
        }}
      >
        {children}
      </Card>
    </div>
  );
}

export default function OverviewPage() {
  const router = useRouter();
  const toast = useToast();

  const metrics: Metric[] = [
    { label: "Open Function Rooms", value: "7", status: "Active", statusTone: "var(--fg-3)", link: "View all events", href: "/events", icon: "briefcase", accent: null },
    { label: "Credential Alerts", value: "3", status: "Require attention", statusTone: "var(--fg-3)", link: "View alerts", href: "/credentials", icon: "shield-alert", accent: "var(--danger)" },
    { label: "Run Sheet Tasks", value: "64", status: "In progress", statusTone: "var(--fg-3)", link: "View run sheets", href: "/projects", icon: "list-checks", accent: null },
  ];
  const heat: [string, number[]][] = [
    ["Brightwater Hotel", [2, 3, 4, 6, 6, 5, 3]],
    ["Gaming Room", [1, 2, 3, 4, 6, 6, 4]],
    ["Northside Tavern", [1, 2, 4, 5, 6, 5, 3]],
    ["Quayside", [0, 1, 2, 3, 5, 4, 2]],
    ["Off-premise", [0, 1, 1, 2, 4, 5, 2]],
  ];
  const viz = ["#ECF6F4", "#CDEAE4", "#A3DAD0", "#6CC6B8", "#2FA897", "#0D8B82", "#075A54"];
  const activity: Activity[] = [
    { icon: "log-in", tone: "success", text: <><b>James Carter</b> clocked in at 7:02am</>, meta: "Commercial Build – Level 3", t: "2m ago", href: "/attendance", toast: "Opening attendance for James Carter" },
    { icon: "message-square-plus", tone: "info", text: <>New function room <b>&quot;Spring Carnival Marquee&quot;</b> created by Sarah Lee</>, meta: "", t: "15m ago", href: "/events", toast: "Opening function room: Spring Carnival Marquee" },
    { icon: "shield-alert", tone: "danger", text: <>Credential alert: 2 workers require action</>, meta: "", t: "32m ago", href: "/credentials", toast: "Opening credential alerts" },
    { icon: "file-check-2", tone: "teal", text: <>Weekly fairness report is ready to view</>, meta: "", t: "1h ago", href: "/reports", toast: "Opening weekly fairness report" },
  ];
  const projects: [string, string, number, string][] = [
    ["Brightwater Hotel", "Venue", 72, "var(--success)"],
    ["Northside Tavern", "Venue", 48, "var(--warning)"],
    ["Werribee Park Wedding", "Catering", 81, "var(--success)"],
    ["Docklands Corporate Lunch", "Catering", 36, "var(--danger)"],
  ];
  const fairness: [string, number][] = [
    ["Alex Nguyen", 96],
    ["Mia Anderson", 94],
    ["Jordan Lee", 93],
    ["Taylor Wilson", 92],
    ["Casey Brown", 90],
  ];
  const upcoming: [string, string, string[], number][] = [
    ["Today · 4:00pm – 12:00am", "Brightwater Friday Live", ["Ana Reed", "Ben Cole", "Cara Vu"], 6],
    ["Tomorrow · 11:00am – 7:00pm", "Northside Long Lunch", ["Dan Fox", "Eve Ho"], 4],
    ["Wed 15 May · 10:00am – 6:00pm", "Werribee Wedding — bump-in", ["Gus Ray", "Hana Lim"], 3],
  ];

  /* Fairness Trend — period toggle holding multiple datasets in state. */
  const TREND: Record<string, { data: number[]; value: string }> = {
    "7d": { data: [78, 80, 79, 83, 85, 84, 88], value: "88%" },
    "4w": { data: [52, 58, 55, 63, 60, 68, 74, 88], value: "88%" },
    "12w": { data: [44, 48, 51, 55, 53, 60, 64, 69, 72, 78, 82, 86], value: "86%" },
  };
  const TREND_LABEL: Record<string, string> = { "7d": "Last 7 days", "4w": "Last 4 weeks", "12w": "Last 12 weeks" };
  const [period, setPeriod] = useState<string>("4w");
  const trend = TREND[period];

  return (
    <div>
      <PageHead title="Good morning, Emma! 👋" sub="Here's what's happening across your operations." />
      {/* top metric row */}
      <div style={{ display: "grid", gridTemplateColumns: "1.15fr 1.15fr repeat(3,1fr)", gap: 16, marginBottom: 16 }}>
        <ClickableCard pad={18} ariaLabel="View fairness reports" onClick={() => router.push("/reports")} style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 13, color: "var(--fg-3)", fontWeight: 600, marginBottom: 8 }}>Roster Fairness Score</div>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <Ring value={88} label="88%" size={84} />
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "var(--success-fg)" }}>Very Good</div>
              <div style={{ fontSize: 12, color: "var(--success-fg)", marginTop: 4 }}>↑ 6pp vs last 7 days</div>
            </div>
          </div>
        </ClickableCard>
        <ClickableCard pad={18} ariaLabel="View live attendance" onClick={() => router.push("/attendance")} style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 13, color: "var(--fg-3)", fontWeight: 600, marginBottom: 8 }}>Live Attendance</div>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <Ring value={88} label="142" sub="/ 168" size={84} color="var(--success)" />
            <div style={{ fontSize: 12.5, display: "flex", flexDirection: "column", gap: 5 }}>
              <span style={{ display: "flex", justifyContent: "space-between", gap: 14 }}><span style={{ color: "var(--fg-2)" }}><span style={{ color: "var(--success)" }}>●</span> On Shift</span><b className="fs-tnum">112</b></span>
              <span style={{ display: "flex", justifyContent: "space-between", gap: 14 }}><span style={{ color: "var(--fg-2)" }}><span style={{ color: "var(--warning)" }}>●</span> Late</span><b className="fs-tnum">8</b></span>
              <span style={{ display: "flex", justifyContent: "space-between", gap: 14 }}><span style={{ color: "var(--fg-2)" }}><span style={{ color: "var(--danger)" }}>●</span> Absent</span><b className="fs-tnum">22</b></span>
            </div>
          </div>
        </ClickableCard>
        {metrics.map((m, i) => (
          <ClickableCard key={i} pad={18} ariaLabel={m.link} onClick={() => router.push(m.href)} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <span style={{ fontSize: 13, color: "var(--fg-3)", fontWeight: 600 }}>{m.label}</span>
              <Icon name={m.icon} size={17} color={m.accent || "var(--fg-4)"} />
            </div>
            <span className="fs-tnum" style={{ fontSize: 32, fontWeight: 800, letterSpacing: "-.02em" }}>{m.value}</span>
            <span style={{ fontSize: 12.5, color: m.statusTone }}>{m.status}</span>
            <div style={{ marginTop: 6 }}><LinkBtn href={m.href}>{m.link}</LinkBtn></div>
          </ClickableCard>
        ))}
      </div>
      {/* mid row */}
      <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1.4fr 1.3fr", gap: 16, marginBottom: 16 }}>
        <Card>
          <CardHead
            title="Fairness Trend"
            right={<Tabs tabs={["7d", "4w", "12w"]} value={period} onChange={setPeriod} />}
          />
          <div style={{ position: "relative", height: 130 }}>
            <Spark data={trend.data} width={300} height={120} />
            <span style={{ position: "absolute", top: 0, right: 0, background: "var(--fs-teal)", color: "#fff", fontSize: 12, fontWeight: 700, padding: "3px 8px", borderRadius: 6 }}>{trend.value}</span>
            <span style={{ position: "absolute", bottom: 0, left: 0, fontSize: 11.5, color: "var(--fg-4)" }}>{TREND_LABEL[period]}</span>
          </div>
        </Card>
        <Card>
          <CardHead title="Attendance Heatmap (Today)" right={<LinkBtn href="/attendance">View attendance</LinkBtn>} />
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
          <CardHead title="Recent Activity" right={<LinkBtn href="/comms">View all</LinkBtn>} />
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {activity.map((a, i) => {
              const [bg, fg] = STATUS[a.tone];
              return (
                <button
                  key={i}
                  type="button"
                  className="hov-row"
                  onClick={() => {
                    toast(a.toast, { tone: a.tone, icon: a.icon });
                    router.push(a.href);
                  }}
                  style={{
                    display: "flex",
                    gap: 11,
                    alignItems: "flex-start",
                    width: "100%",
                    textAlign: "left",
                    border: 0,
                    background: "transparent",
                    font: "inherit",
                    cursor: "pointer",
                    padding: "9px 8px",
                    margin: "0 -8px",
                    borderRadius: 10,
                  }}
                >
                  <span style={{ width: 30, height: 30, borderRadius: 8, background: bg, color: fg, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Icon name={a.icon} size={16} /></span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, color: "var(--fg-2)", lineHeight: 1.4 }}>{a.text}</div>
                    {a.meta && <div style={{ fontSize: 11.5, color: "var(--fg-4)" }}>{a.meta}</div>}
                  </div>
                  <span style={{ fontSize: 11.5, color: "var(--fg-4)", whiteSpace: "nowrap" }}>{a.t}</span>
                </button>
              );
            })}
          </div>
        </Card>
        <Card>
          <CardHead title="Venues & Events" right={<LinkBtn href="/projects">View all</LinkBtn>} />
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
          <CardHead title="Top Fairness Contributors" right={<LinkBtn href="/reports">View report</LinkBtn>} />
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
