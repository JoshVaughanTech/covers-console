"use client";

import { Card, Ring, Bar, MetricCard, Badge, Avatar, Button, Icon, STATUS } from "@/components/ui";
import type { Tone } from "@/lib/status";
import { PageHead, CardHead, LinkBtn } from "@/components/screen/page-head";

export default function SchedulePage() {
  const days = ["Mon\n12", "Tue\n13", "Wed\n14", "Thu\n15", "Fri\n16", "Sat\n17", "Sun\n18"];
  const roster: [string, string, number[]][] = [
    ["Registered Nurse", "Req. 65h / day", [68, 64, 62, 70, 69, 61, 55]],
    ["Enrolled Nurse", "Req. 45h / day", [44, 46, 45, 42, 47, 44, 38]],
    ["Personal Care Attendant", "Req. 70h / day", [72, 70, 68, 71, 73, 69, 60]],
    ["Administration", "Req. 30h / day", [30, 30, 30, 28, 30, 30, 30]],
    ["Allied Health", "Req. 20h / day", [20, 18, 20, 20, 20, 18, 16]],
  ];
  // status by fill ratio
  const cell = (v: number, req: number): [string, string] => {
    const ratio = v / req;
    if (ratio >= 0.98) return ["var(--success-bg)", "var(--success-fg)"]; // covered
    if (ratio >= 0.88) return ["var(--warning-bg)", "var(--warning-fg)"]; // at risk
    return ["var(--danger-bg)", "var(--danger-fg)"]; // uncovered
  };
  const reqMap: Record<string, number> = {
    "Registered Nurse": 65,
    "Enrolled Nurse": 45,
    "Personal Care Attendant": 70,
    Administration: 30,
    "Allied Health": 20,
  };
  const fairness: [string, string, string, string, Tone][] = [
    ["Mia Anderson", "32h", "31h", "Excellent", "success"],
    ["James Carter", "32h", "29h", "Good", "success"],
    ["Sarah Bennett", "24h", "22h", "Fair", "warning"],
    ["Alex Nguyen", "24h", "18h", "Needs Attention", "danger"],
  ];
  const suggestions: [string, string, Tone][] = [
    ["Fill 7 open shifts to reach 100% coverage", "High priority · Improves coverage by 4%", "danger"],
    ["Balance weekend load for fairer distribution", "Reassign 6 shifts · Improves fairness by 5 pts", "warning"],
    ["Reduce overtime on Sat, May 17", "Swap 3 shifts · Potential savings $2,140", "info"],
    ["Consider employee preferences", "7 matches available · Higher acceptance likely", "teal"],
  ];
  const preview: [string, string, string[], string][] = [
    ["Mia Anderson", "Registered Nurse", ["7a – 3p", "7a – 3p", "7a – 3p", "7a – 3p", "7a – 3p", "7a – 3p", "—"], "36h"],
    ["James Carter", "Registered Nurse", ["3p – 11p", "3p – 11p", "—", "7a – 3p", "3p – 11p", "3p – 11p", "—"], "32h"],
    ["Sarah Bennett", "Enrolled Nurse", ["7a – 3p", "—", "3p – 11p", "3p – 11p", "—", "7a – 3p", "—"], "24h"],
    ["Alex Nguyen", "Personal Care Attendant", ["11a – 7p", "11a – 7p", "11a – 7p", "—", "11a – 7p", "11a – 7p", "11a – 7p"], "30h"],
  ];
  const shiftColor: Record<string, [string, string]> = {
    "7a – 3p": ["#E6F4F2", "#075A54"],
    "3p – 11p": ["#E8F1FC", "#1E5FB0"],
    "11a – 7p": ["#EDEAFB", "#5B4BC4"],
  };
  return (
    <div>
      <PageHead
        title="Schedule"
        sub="AI-powered scheduling that balances fairness, coverage, and cost."
        right={
          <div style={{ display: "flex", gap: 10 }}>
            <Button variant="sec" size="sm" icon="git-compare">Compare Scenarios</Button>
            <Button size="sm" icon="send">Publish Roster</Button>
          </div>
        }
      />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16, marginBottom: 16 }}>
        <Card pad={18}>
          <div style={{ fontSize: 13, color: "var(--fg-3)", fontWeight: 600, marginBottom: 8 }}>Roster Fairness Score</div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Ring value={87} label="87%" size={76} />
            <div><div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--success-fg)" }}>Very Good</div><div style={{ fontSize: 11.5, color: "var(--success-fg)", marginTop: 3 }}>↑ 6 pts vs last 7 days</div></div>
          </div>
        </Card>
        <MetricCard label="Labour Cost" value="$128,450" trend="↓ 4.3% vs last 7 days" trendTone="var(--success-fg)">
          <div style={{ marginTop: 10 }}><Bar value={95} /></div>
          <div style={{ fontSize: 11, color: "var(--fg-4)", marginTop: 5 }}>Budget $135,000</div>
        </MetricCard>
        <Card pad={18}>
          <div style={{ fontSize: 13, color: "var(--fg-3)", fontWeight: 600, marginBottom: 8 }}>Coverage</div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Ring value={96} label="96%" size={76} color="var(--success)" />
            <div><div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--fg-1)" }}>On Track</div><div style={{ fontSize: 11.5, color: "var(--success-fg)", marginTop: 3 }}>↑ 3% vs last 7 days</div></div>
          </div>
        </Card>
        <MetricCard label="Open Shifts" value="7" status="Needs Fill" statusTone="var(--warning-fg)">
          <div style={{ marginTop: 8 }}><LinkBtn href="/schedule">View open shifts</LinkBtn></div>
        </MetricCard>
      </div>
      {/* roster grid */}
      <Card style={{ marginBottom: 16 }}>
        <CardHead
          title="Weekly Roster Overview"
          right={
            <div style={{ display: "flex", gap: 14, fontSize: 11.5, color: "var(--fg-3)" }}>
              <span><span style={{ color: "var(--success)" }}>■</span> Covered</span>
              <span><span style={{ color: "var(--warning)" }}>■</span> At Risk</span>
              <span><span style={{ color: "var(--danger)" }}>■</span> Uncovered</span>
            </div>
          }
        />
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: "6px 10px", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--fg-4)" }}>Role</th>
              {days.map((d) => <th key={d} style={{ padding: "6px 4px", fontSize: 11.5, color: "var(--fg-3)", whiteSpace: "pre-line", fontWeight: 600 }}>{d}</th>)}
            </tr>
          </thead>
          <tbody>
            {roster.map(([role, req, vals], i) => (
              <tr key={i}>
                <td style={{ padding: "6px 10px" }}><div style={{ fontSize: 13, fontWeight: 600, color: "var(--fg-1)" }}>{role}</div><div style={{ fontSize: 11, color: "var(--fg-4)" }}>{req}</div></td>
                {vals.map((v, j) => {
                  const [bg, fg] = cell(v, reqMap[role]);
                  return (
                    <td key={j} style={{ padding: "4px 4px" }}><div className="fs-tnum" style={{ background: bg, color: fg, fontSize: 13, fontWeight: 700, textAlign: "center", padding: "11px 0", borderRadius: 8 }}>{v}h</div></td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 16 }}>
        {/* AI roster preview */}
        <Card pad={0}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
            <h4 style={{ margin: 0, fontSize: 15.5, flex: 1 }}>AI Roster Preview <span style={{ fontSize: 12.5, fontWeight: 500, color: "var(--fg-4)" }}>(May 12 – May 18, 2024)</span></h4>
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: "8px 16px", fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", color: "var(--fg-4)" }}>Employee</th>
                {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => <th key={i} style={{ padding: "8px 4px", fontSize: 11, color: "var(--fg-4)", fontWeight: 600 }}>{d}</th>)}
                <th style={{ padding: "8px 12px", fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", color: "var(--fg-4)", textAlign: "right" }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {preview.map((p, i) => (
                <tr key={i} style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={{ padding: "8px 16px" }}><div style={{ display: "flex", alignItems: "center", gap: 8 }}><Avatar name={p[0]} size={24} /><span><div style={{ fontWeight: 600, color: "var(--fg-1)", fontSize: 12.5 }}>{p[0]}</div><div style={{ fontSize: 10.5, color: "var(--fg-4)" }}>{p[1]}</div></span></div></td>
                  {p[2].map((s, j) => {
                    const c = shiftColor[s];
                    return <td key={j} style={{ padding: "5px 3px", textAlign: "center" }}>{s === "—" ? <span style={{ color: "var(--fg-4)" }}>—</span> : <span className="fs-tnum" style={{ background: c[0], color: c[1], fontSize: 10.5, fontWeight: 600, padding: "4px 5px", borderRadius: 6, display: "inline-block", whiteSpace: "nowrap" }}>{s}</span>}</td>;
                  })}
                  <td className="fs-tnum" style={{ padding: "8px 12px", textAlign: "right", fontWeight: 700, color: "var(--fg-1)" }}>{p[3]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        {/* AI suggestions + fairness */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Card>
            <CardHead
              title={<span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}><Icon name="sparkles" size={16} color="var(--fs-teal)" />AI Suggestions</span>}
              right={<span style={{ fontSize: 11.5, color: "var(--fg-4)" }}>4 recommendations</span>}
            />
            <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
              {suggestions.map(([t, s, tone], i) => {
                const [, , dc] = STATUS[tone];
                return (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 10, cursor: "pointer" }} className="hov-row">
                    <span style={{ width: 8, height: 8, borderRadius: 999, background: dc, flexShrink: 0 }} />
                    <div style={{ flex: 1 }}><div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--fg-1)" }}>{t}</div><div style={{ fontSize: 11, color: "var(--fg-4)" }}>{s}</div></div>
                    <Icon name="chevron-right" size={16} color="var(--fg-4)" />
                  </div>
                );
              })}
            </div>
          </Card>
          <Card>
            <CardHead title="Fairness Overview" right={<LinkBtn>View all</LinkBtn>} />
            <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
              {fairness.map(([n, req, sch, label, tone], i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 9 }}>
                  <Avatar name={n} size={26} />
                  <span style={{ flex: 1, fontSize: 12.5, fontWeight: 600, color: "var(--fg-1)" }}>{n}</span>
                  <span className="fs-tnum" style={{ fontSize: 11.5, color: "var(--fg-4)" }}>{sch}/{req}</span>
                  <Badge tone={tone}>{label}</Badge>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
