"use client";

import { Card, Bar, Avatar, Badge, Button, Icon, STATUS } from "@/components/ui";
import type { Tone } from "@/lib/status";
import { CardHead, LinkBtn } from "@/components/screen/page-head";

export default function CredentialsPage() {
  const reqs: [string, number, string, Tone][] = [
    ["Security Licence", 32, "shield", "warning"],
    ["First Aid", 34, "plus-square", "warning"],
    ["White Card", 36, "id-card", "success"],
    ["Site Induction", 31, "clipboard-list", "warning"],
    ["Access Approval", 28, "key-round", "danger"],
    ["Fatigue Status", 33, "battery-medium", "warning"],
  ];
  const workers: [string, string, string, Tone, number, string, string, string][] = [
    ["Daniel Roberts", "9587 4632 7876", "Eligible", "success", 100, "—", "Fit", "Approved"],
    ["Sarah Thompson", "6738 2910 4421", "Warning", "warning", 83, "Site Induction missing", "Fit", "Approved"],
    ["Michael Chen", "2846 9011 7783", "Blocked", "danger", 50, "Security Licence expired", "Fit", "—"],
    ["Priya Nair", "5590 3312 6679", "Warning", "warning", 67, "Access Approval expiring · Site Induction missing", "Fit", "Pending"],
    ["James Walker", "1123 5566 8890", "Blocked", "danger", 40, "Fatigue risk – review", "At Risk", "Approved"],
  ];
  const creds: [string, string, string, string, string][] = [
    ["Security Licence", "NSW · 00012345", "Expires 12 May 2026", "shield", "Verified"],
    ["First Aid (HLTAID011)", "Expires 20 Oct 2025", "", "plus-square", "Verified"],
    ["White Card (CPCCWHS1001)", "Expires 14 Aug 2026", "", "id-card", "Verified"],
    ["Site Induction", "Lendlease – RNSH", "Completed 2 May 2024", "clipboard-list", "Verified"],
    ["Access Approval", "RNSH – Security", "Expires 30 May 2025", "key-round", "Approved"],
    ["Fatigue Status", "Fit for Duty · As at today, 6:15am", "", "battery-medium", "Fit"],
  ];
  const log: [string, string, string, Tone][] = [
    ["Credential verified", "Security Licence", "shield-check", "success"],
    ["Access granted", "RNSH – Security", "key-round", "success"],
    ["Shift acknowledged", "Hospital Security Coverage", "check-circle-2", "info"],
    ["Site induction verified", "RNSH", "clipboard-check", "success"],
    ["Fatigue status updated", "Fit for Duty", "battery-medium", "success"],
  ];
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
          <img src="/assets/idara-icon-t.png" alt="idara" style={{ width: 18, height: 18 }} />
          <span style={{ fontWeight: 800, fontSize: 17, color: "var(--fg-1)" }}>Idara Verify</span>
        </span>
        <Icon name="chevron-right" size={15} color="var(--fg-4)" />
        <span style={{ fontSize: 15, color: "var(--fg-3)", fontWeight: 600 }}>Credentials &amp; Eligibility</span>
      </div>
      <p style={{ margin: "0 0 18px", fontSize: 14 }}>Real-time verification and roster eligibility for the right person, every shift.</p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 16, alignItems: "start" }}>
        <div>
          {/* job header */}
          <Card style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16 }}>
            <span style={{ width: 46, height: 46, borderRadius: 11, background: "var(--fs-teal-tint)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}><Icon name="building-2" size={22} color="var(--fs-teal-700)" /></span>
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 9 }}><span style={{ fontSize: 16, fontWeight: 700, color: "var(--fg-1)" }}>Hospital Security Coverage</span><Badge tone="success" dot>Active</Badge></div>
              <div style={{ fontSize: 12.5, color: "var(--fg-3)", marginTop: 2 }}>Royal North Shore Hospital · Thu, 16 May 2024 · 7:00am – 3:30pm (8.5h)</div>
            </div>
            <Button variant="sec" size="sm">Edit Job</Button>
            <Button size="sm">Check Eligibility</Button>
          </Card>
          {/* job requirements */}
          <Card style={{ marginBottom: 16 }}>
            <CardHead title="Job Requirements" right={<span style={{ fontSize: 11.5, color: "var(--fg-4)", display: "inline-flex", alignItems: "center", gap: 5 }}><Icon name="refresh-cw" size={13} />Last updated: 2 mins ago</span>} />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(6,1fr)", gap: 10 }}>
              {reqs.map(([n, v, icon, tone], i) => {
                const [, , dc] = STATUS[tone];
                return (
                  <div key={i} style={{ border: "1px solid var(--border)", borderRadius: 11, padding: 12, display: "flex", flexDirection: "column", gap: 7 }}>
                    <Icon name={icon} size={18} color="var(--fs-teal)" />
                    <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--fg-2)", lineHeight: 1.25 }}>{n}<div style={{ fontSize: 10, color: "var(--fg-4)", fontWeight: 500 }}>Required</div></div>
                    <div className="fs-tnum" style={{ fontSize: 16, fontWeight: 800, color: "var(--fg-1)" }}>{v}<span style={{ fontSize: 12, color: "var(--fg-4)", fontWeight: 600 }}> / 36</span></div>
                    <Bar value={(v / 36) * 100} color={dc} height={4} />
                  </div>
                );
              })}
            </div>
          </Card>
          {/* roster eligibility */}
          <Card pad={0}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
              <h4 style={{ margin: 0, fontSize: 15.5 }}>Roster Eligibility</h4>
              <div style={{ flex: 1 }} />
              {([["All", 36], ["Eligible", 22], ["Warning", 8], ["Blocked", 6]] as [string, number][]).map(([f, n], i) => (
                <span key={f} style={{ fontSize: 12.5, fontWeight: 600, color: i === 0 ? "var(--fs-teal)" : "var(--fg-3)", display: "inline-flex", gap: 5, padding: "4px 9px", borderRadius: 7, background: i === 0 ? "var(--fs-teal-tint)" : "transparent" }}>{f} <span style={{ color: "var(--fg-4)" }}>{n}</span></span>
              ))}
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead>
                <tr>
                  {["Worker", "Status", "Match", "Missing / Issues", "Fatigue", "Access"].map((h) => (
                    <th key={h} style={{ textAlign: "left", padding: "9px 14px", fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--fg-4)" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {workers.map((w, i) => (
                  <tr key={i} style={{ borderTop: "1px solid var(--border)" }} className="hov-row">
                    <td style={{ padding: "11px 14px" }}><div style={{ display: "flex", alignItems: "center", gap: 9 }}><Avatar name={w[0]} size={28} /><span><div style={{ fontWeight: 600, color: "var(--fg-1)" }}>{w[0]}</div><div className="fs-tnum" style={{ fontSize: 10.5, color: "var(--fg-4)" }}>ID: {w[1]}</div></span></div></td>
                    <td style={{ padding: "11px 14px" }}><Badge tone={w[3]} dot>{w[2]}</Badge></td>
                    <td style={{ padding: "11px 14px", minWidth: 90 }}><div className="fs-tnum" style={{ fontSize: 12, fontWeight: 700, color: "var(--fg-1)", marginBottom: 4 }}>{w[4]}%</div><Bar value={w[4]} color={w[4] >= 90 ? "var(--success)" : w[4] >= 60 ? "var(--warning)" : "var(--danger)"} height={4} /></td>
                    <td style={{ padding: "11px 14px", color: w[5] === "—" ? "var(--fg-4)" : "var(--warning-fg)", fontSize: 12, maxWidth: 200 }}>{w[5]}</td>
                    <td style={{ padding: "11px 14px" }}>{w[6] === "Fit" ? <span style={{ color: "var(--success-fg)", fontWeight: 600, display: "inline-flex", gap: 5, alignItems: "center" }}><span style={{ width: 6, height: 6, borderRadius: 999, background: "var(--success)" }} />Fit</span> : <span style={{ color: "var(--danger-fg)", fontWeight: 600, display: "inline-flex", gap: 5, alignItems: "center" }}><Icon name="triangle-alert" size={13} />At Risk</span>}</td>
                    <td style={{ padding: "11px 14px" }}>{w[7] === "—" ? <span style={{ color: "var(--fg-4)" }}>—</span> : <Badge tone={w[7] === "Approved" ? "success" : "warning"}>{w[7]}</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ padding: "12px 16px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, color: "var(--fg-4)" }}>
              <span>Showing 1 to 5 of 36 workers</span>
              <span style={{ display: "flex", gap: 6 }}>{["1", "2", "3", "4", "5"].map((p, i) => <span key={p} style={{ width: 26, height: 26, borderRadius: 7, display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 600, background: i === 0 ? "var(--fs-teal)" : "transparent", color: i === 0 ? "#fff" : "var(--fg-3)", border: i === 0 ? 0 : "1px solid var(--border)" }}>{p}</span>)}</span>
            </div>
          </Card>
        </div>
        {/* worker verification panel */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Card>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>Worker Verification</div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
              <Avatar name="Daniel Roberts" size={46} />
              <div><div style={{ fontSize: 15, fontWeight: 700, color: "var(--fg-1)" }}>Daniel Roberts</div><div className="fs-tnum" style={{ fontSize: 11.5, color: "var(--fg-4)" }}>ID: 9587 4632 7876</div></div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "8px 11px", background: "var(--success-bg)", borderRadius: 9, marginBottom: 14 }}>
              <Icon name="badge-check" size={16} color="var(--success-fg)" /><span style={{ fontSize: 12, fontWeight: 700, color: "var(--success-fg)" }}>VERIFIED IDENTITY</span>
              <span style={{ marginLeft: "auto", fontSize: 10.5, color: "var(--success-fg)", opacity: 0.8 }}>Today, 6:15am</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
              {creds.map((c, i) => (
                <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                  <span style={{ width: 30, height: 30, borderRadius: 8, background: "var(--bg-2)", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Icon name={c[3]} size={15} color="var(--fs-teal)" /></span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--fg-1)" }}>{c[0]}</div>
                    <div style={{ fontSize: 11, color: "var(--fg-4)" }}>{c[1]}{c[2] && <> · {c[2]}</>}</div>
                  </div>
                  <Badge tone="success" icon="check">{c[4]}</Badge>
                </div>
              ))}
            </div>
            <Button variant="sec" size="sm" iconRight="external-link" style={{ width: "100%", marginTop: 14 }}>View Full Profile</Button>
          </Card>
          <Card>
            <CardHead title="Event Log" right={<LinkBtn>View all</LinkBtn>} />
            <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
              {log.map((e, i) => {
                const [bg, fg] = STATUS[e[3]];
                return (
                  <div key={i} style={{ display: "flex", gap: 10, padding: "9px 0", borderTop: i ? "1px solid var(--border)" : 0 }}>
                    <span style={{ width: 26, height: 26, borderRadius: 7, background: bg, color: fg, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Icon name={e[2]} size={14} /></span>
                    <div style={{ flex: 1 }}><div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--fg-1)" }}>{e[0]}</div><div style={{ fontSize: 11, color: "var(--fg-4)" }}>{e[1]}</div></div>
                    <span style={{ fontSize: 10.5, color: "var(--fg-4)", whiteSpace: "nowrap" }}>Today, 6:15am</span>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
