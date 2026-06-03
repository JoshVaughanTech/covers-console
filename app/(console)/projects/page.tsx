"use client";

import { Card, Ring, Bar, Avatar, AvatarStack, Badge, Icon, STATUS } from "@/components/ui";
import type { Tone } from "@/lib/status";
import { CardHead, LinkBtn } from "@/components/screen/page-head";

interface BoardCard {
  title: string;
  sub: string;
  prio: "High" | "Medium" | "Low" | null;
  due: string | null;
  names: string[];
  extra?: number;
}

export default function ProjectsPage() {
  const board: Record<string, { n: number; cards: BoardCard[] }> = {
    "To Do": {
      n: 12,
      cards: [
        { title: "Install camera – Level 2", sub: "Zone A – Corridor", prio: "High", due: "May 20", names: ["Darie Roberts"] },
        { title: "Pull network cables", sub: "Level 3 – East Wing", prio: "Medium", due: "May 21", names: ["Ben Cole"] },
        { title: "Configure NVR", sub: "Server Room", prio: "Low", due: "May 22", names: ["Ana Reed"] },
      ],
    },
    "In Progress": {
      n: 8,
      cards: [
        { title: "Install cameras – ICU", sub: "Level 4", prio: "High", due: "May 18", names: ["Cara Vu", "Dan Fox"], extra: 2 },
        { title: "Cable containment", sub: "Level 1 – Carpark", prio: "Medium", due: "May 18", names: ["Eve Ho"] },
      ],
    },
    Review: {
      n: 5,
      cards: [{ title: "Test camera feeds", sub: "Level 2", prio: "Medium", due: "May 17", names: ["Gus Ray", "Ben Cole"], extra: 1 }],
    },
    Completed: {
      n: 26,
      cards: [
        { title: "Site survey", sub: "Completed on May 12", prio: null, due: null, names: [] },
        { title: "Rack installation", sub: "Completed on May 13", prio: null, due: null, names: [] },
        { title: "Switch configuration", sub: "Completed on May 14", prio: null, due: null, names: [] },
      ],
    },
  };
  const colTone: Record<string, Tone> = { "To Do": "neutral", "In Progress": "info", Review: "warning", Completed: "success" };
  const prio: Record<"High" | "Medium" | "Low", Tone> = { High: "danger", Medium: "warning", Low: "neutral" };
  const timeline: [string, string, boolean | "active"][] = [
    ["Project Kick-off", "May 1", true],
    ["Site Survey", "May 5", true],
    ["Design & Planning", "May 10", true],
    ["Installation", "May 12 – May 28", "active"],
    ["Testing & Commissioning", "May 29 – Jun 2", false],
    ["Handover", "Jun 3", false],
  ];
  const docs: [string, string][] = [
    ["CCTV Layout – Level 4.dwg", "DWG · May 15, 2024 · v2.1"],
    ["Network Diagram – Rev B.pdf", "PDF · May 14, 2024 · v1.3"],
    ["Equipment Schedule.xlsx", "XLSX · May 13, 2024 · v1.0"],
    ["Installation Guide – Cameras.pdf", "PDF · May 12, 2024 · v1.0"],
  ];
  const team: [string, string, string][] = [
    ["Darie Roberts", "CCTV Installation", "32 hrs"],
    ["Shane Walker", "Cabling & Network", "28 hrs"],
    ["Lucy Bennett", "Quality & Testing", "24 hrs"],
    ["Ava Chen", "Project Engineer", "20 hrs"],
  ];
  const activity: [string, string, string, string, Tone][] = [
    ["Darie Roberts", "completed Install camera – ICU Room 402", "10:24 AM", "check-circle-2", "success"],
    ["Shane Walker", "uploaded 4 photos", "09:58 AM", "image", "info"],
    ["Lucy Bennett", "raised an issue: Camera angle misalignment", "09:32 AM", "triangle-alert", "warning"],
    ["Ava Chen", "updated task: Test camera feeds", "09:15 AM", "edit-3", "teal"],
  ];

  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 16, marginBottom: 18 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}><h2 style={{ margin: 0, fontSize: 24 }}>Hospital CCTV Upgrade</h2><Badge tone="success" dot>Active</Badge><Icon name="star" size={17} color="var(--warning)" /></div>
          <p style={{ margin: "4px 0 0", fontSize: 14 }}>Secure. Reliable. Always On.</p>
          <div style={{ display: "flex", gap: 18, marginTop: 12, fontSize: 13 }}>
            {["Dashboard", "Tasks", "Timeline", "Documents", "Team", "Issues", "Reports", "Settings"].map((t, i) => <span key={t} style={{ fontWeight: i === 0 ? 700 : 600, color: i === 0 ? "var(--fs-teal)" : "var(--fg-4)", paddingBottom: 6, borderBottom: i === 0 ? "2px solid var(--fs-teal)" : 0 }}>{t}</span>)}
          </div>
        </div>
      </div>
      {/* metric row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 16, marginBottom: 16 }}>
        <Card pad={16}><div style={{ fontSize: 12.5, color: "var(--fg-3)", fontWeight: 600, marginBottom: 6 }}>Tasks Completed</div><div style={{ display: "flex", alignItems: "center", gap: 12 }}><Ring value={72} label="72%" size={66} /><div><div className="fs-tnum" style={{ fontSize: 13, fontWeight: 700 }}>86 / 120</div><div style={{ fontSize: 11, color: "var(--success-fg)", marginTop: 2 }}>↑ 12% vs last 7 days</div></div></div></Card>
        <Card pad={16}><div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ fontSize: 12.5, color: "var(--fg-3)", fontWeight: 600 }}>Open Issues</span><Icon name="shield-alert" size={16} color="var(--danger)" /></div><div className="fs-tnum" style={{ fontSize: 30, fontWeight: 800, margin: "4px 0 2px" }}>8</div><div style={{ fontSize: 11, color: "var(--fg-4)" }}>High: 2 · Medium: 6</div><div style={{ fontSize: 11, color: "var(--danger-fg)", marginTop: 4 }}>↓ 2 vs last 7 days</div></Card>
        <Card pad={16}><div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ fontSize: 12.5, color: "var(--fg-3)", fontWeight: 600 }}>Labour Hours</span><Icon name="clock" size={16} color="var(--fs-teal)" /></div><div className="fs-tnum" style={{ fontSize: 30, fontWeight: 800, margin: "4px 0 2px" }}>1,248<span style={{ fontSize: 14, color: "var(--fg-4)" }}> hrs</span></div><div style={{ fontSize: 11, color: "var(--success-fg)", marginTop: 4 }}>↑ 9% vs last 7 days</div></Card>
        <Card pad={16}><div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ fontSize: 12.5, color: "var(--fg-3)", fontWeight: 600 }}>Verified Sign-offs</span><Icon name="badge-check" size={16} color="var(--success)" /></div><div className="fs-tnum" style={{ fontSize: 30, fontWeight: 800, margin: "4px 0 2px" }}>36</div><div style={{ fontSize: 11, color: "var(--fg-4)" }}>This week</div><div style={{ fontSize: 11, color: "var(--success-fg)", marginTop: 4 }}>↑ 18% vs last 7 days</div></Card>
        <Card pad={16}><div style={{ fontSize: 12.5, color: "var(--fg-3)", fontWeight: 600, marginBottom: 6 }}>Project Progress</div><div style={{ display: "flex", alignItems: "center", gap: 12 }}><Ring value={68} label="68%" size={66} color="var(--success)" /><div><div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--fg-1)" }}>On track</div><div style={{ fontSize: 11, color: "var(--success-fg)", marginTop: 2 }}>↑ 6% vs last 7 days</div></div></div></Card>
      </div>
      {/* main row */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 300px 320px", gap: 16, marginBottom: 16 }}>
        {/* task board */}
        <Card pad={16}>
          <CardHead title="Task Board" right={<Icon name="more-horizontal" size={16} color="var(--fg-4)" />} />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10 }}>
            {Object.entries(board).map(([col, data]) => {
              const [bg, fg] = STATUS[colTone[col]];
              return (
                <div key={col} style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 8px", borderRadius: 7, background: bg, marginBottom: 8 }}><span style={{ fontSize: 11.5, fontWeight: 700, color: fg, flex: 1 }}>{col}</span><span style={{ fontSize: 11, fontWeight: 700, color: fg }}>{data.n}</span></div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {data.cards.map((c, i) => (
                      <div key={i} style={{ border: "1px solid var(--border)", borderRadius: 9, padding: 9, background: col === "Completed" ? "var(--surface-2)" : "#fff" }}>
                        <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--fg-1)", lineHeight: 1.25 }}>{c.title}</div>
                        <div style={{ fontSize: 10, color: "var(--fg-4)", marginTop: 2 }}>{c.sub}</div>
                        {c.prio && <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 7 }}><Badge tone={prio[c.prio]} style={{ fontSize: 9, padding: "2px 6px" }}>{c.prio}</Badge><span style={{ fontSize: 9.5, color: "var(--fg-4)", flex: 1 }}>{c.due}</span>{c.names.length > 0 && <AvatarStack names={c.names} size={18} max={2} extra={c.extra} />}</div>}
                        {col === "Completed" && <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 6 }}><Icon name="check-circle-2" size={12} color="var(--success)" /></div>}
                      </div>
                    ))}
                    <div style={{ fontSize: 10.5, color: "var(--fg-4)", fontWeight: 600, padding: "4px 0", cursor: "pointer" }}>+ Add task</div>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
        {/* timeline */}
        <Card pad={16}>
          <CardHead title="Project Timeline" />
          <div style={{ display: "flex", flexDirection: "column" }}>
            {timeline.map((t, i) => (
              <div key={i} style={{ display: "flex", gap: 11 }}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                  <span style={{ width: 20, height: 20, borderRadius: 999, background: t[2] === true ? "var(--success)" : t[2] === "active" ? "var(--fs-teal)" : "#fff", border: t[2] === false ? "2px solid var(--border-2)" : 0, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{t[2] === true && <Icon name="check" size={12} color="#fff" />}{t[2] === "active" && <span style={{ width: 7, height: 7, borderRadius: 999, background: "#fff" }} />}</span>
                  {i < timeline.length - 1 && <span style={{ width: 2, flex: 1, minHeight: 22, background: t[2] === true ? "var(--success)" : "var(--border-2)" }} />}
                </div>
                <div style={{ paddingBottom: 14 }}><div style={{ fontSize: 12.5, fontWeight: 700, color: t[2] === false ? "var(--fg-4)" : "var(--fg-1)" }}>{t[0]}</div><div style={{ fontSize: 11, color: "var(--fg-4)" }}>{t[1]}</div></div>
              </div>
            ))}
          </div>
        </Card>
        {/* verified sign-off */}
        <Card pad={16}>
          <CardHead title="Verified Sign-off" right={<LinkBtn>View all</LinkBtn>} />
          <div style={{ border: "1px solid var(--success-bg)", borderRadius: 12, overflow: "hidden" }}>
            <div style={{ background: "var(--success-bg)", padding: "8px 12px", display: "flex", alignItems: "center", gap: 7 }}><Icon name="check-circle-2" size={14} color="var(--success-fg)" /><span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--success-fg)", flex: 1 }}>Task Completed</span><Badge tone="success">Completed</Badge></div>
            <div style={{ padding: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--fg-1)" }}>Install camera – ICU Room 402</div>
              <div style={{ fontSize: 11, color: "var(--fg-4)", marginBottom: 10 }}>Level 4 – Zone B</div>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--fg-4)", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 6 }}>Technician</div>
              <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 10 }}><Avatar name="Darie Roberts" size={28} /><div style={{ flex: 1 }}><div style={{ fontSize: 12, fontWeight: 700, color: "var(--fg-1)" }}>Darie Roberts</div><div style={{ fontSize: 10, color: "var(--success-fg)", display: "flex", alignItems: "center", gap: 3 }}><img src="/assets/idara-icon-t.png" alt="idara" style={{ width: 10, height: 10 }} />ID: 9647 · Idara Verified</div></div><span style={{ fontSize: 10, color: "var(--fg-4)" }}>10:24 AM</span></div>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--fg-4)", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 6 }}>Evidence</div>
              <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>{["#D9E2E8", "#C7D6DE", "#DDE6EB"].map((c, i) => <span key={i} style={{ width: 42, height: 32, borderRadius: 6, background: c, display: "inline-flex", alignItems: "center", justifyContent: "center" }}><Icon name="image" size={13} color="var(--fg-4)" /></span>)}<span style={{ width: 42, height: 32, borderRadius: 6, background: "var(--bg-2)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: "var(--fg-3)" }}>+3</span></div>
              {([["Supervisor Approval", "Lucy Bennett", "May 16, 2024 · 10:45 AM"], ["Client Approval", "Michael Harris", "May 16, 2024 · 11:02 AM"]] as [string, string, string][]).map((a, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 0", borderTop: "1px solid var(--border)" }}><Avatar name={a[1]} size={22} /><div style={{ flex: 1 }}><div style={{ fontSize: 10, color: "var(--fg-4)" }}>{a[0]}</div><div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--fg-1)" }}>{a[1]}</div></div><Badge tone="success">Approved</Badge></div>
              ))}
              <div style={{ display: "flex", alignItems: "center", gap: 5, justifyContent: "center", marginTop: 10, fontSize: 10.5, color: "var(--fg-4)" }}><img src="/assets/idara-icon-t.png" alt="idara" style={{ width: 12, height: 12, opacity: 0.6 }} />Verified by idara</div>
            </div>
          </div>
        </Card>
      </div>
      {/* bottom row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16 }}>
        <Card pad={16}><CardHead title="Documents & Drawings" right={<LinkBtn>View all</LinkBtn>} />{docs.map((d, i) => (<div key={i} style={{ display: "flex", alignItems: "center", gap: 9, padding: "8px 0", borderTop: i ? "1px solid var(--border)" : 0 }}><span style={{ width: 28, height: 28, borderRadius: 7, background: "var(--danger-bg)", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Icon name="file-text" size={14} color="var(--danger-fg)" /></span><div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--fg-1)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{d[0]}</div><div style={{ fontSize: 10, color: "var(--fg-4)" }}>{d[1]}</div></div></div>))}</Card>
        <Card pad={16}><CardHead title="Team Allocation" right={<LinkBtn>View full team</LinkBtn>} />{team.map((t, i) => (<div key={i} style={{ display: "flex", alignItems: "center", gap: 9, padding: "8px 0", borderTop: i ? "1px solid var(--border)" : 0 }}><Avatar name={t[0]} size={28} /><div style={{ flex: 1 }}><div style={{ fontSize: 12, fontWeight: 600, color: "var(--fg-1)" }}>{t[0]}</div><div style={{ fontSize: 10, color: "var(--fg-4)" }}>{t[1]}</div></div><span className="fs-tnum" style={{ fontSize: 11.5, fontWeight: 700, color: "var(--fg-2)" }}>{t[2]}</span></div>))}<div style={{ fontSize: 11, color: "var(--fg-4)", marginTop: 8 }}>+1 team members</div></Card>
        <Card pad={16}><CardHead title="Live Site Activity" right={<LinkBtn>View all</LinkBtn>} />{activity.map((a, i) => { const [bg, fg] = STATUS[a[4]]; return (<div key={i} style={{ display: "flex", gap: 9, padding: "8px 0", borderTop: i ? "1px solid var(--border)" : 0 }}><span style={{ width: 26, height: 26, borderRadius: 7, background: bg, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Icon name={a[3]} size={13} color={fg} /></span><div style={{ flex: 1 }}><div style={{ fontSize: 11, color: "var(--fg-2)", lineHeight: 1.35 }}><b style={{ color: "var(--fg-1)" }}>{a[0]}</b> {a[1]}</div><div style={{ fontSize: 10, color: "var(--fg-4)" }}>{a[2]}</div></div></div>); })}</Card>
        <Card pad={16}><div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 12 }}><h4 style={{ margin: 0, fontSize: 14, flex: 1 }}>Compliance Summary</h4><img src="/assets/idara-icon-t.png" alt="idara" style={{ width: 14, height: 14 }} /></div><div style={{ display: "flex", alignItems: "center", gap: 12 }}><Ring value={96} label="96%" size={70} color="var(--success)" /><div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 7 }}>{([["Inductions", 100], ["Competencies", 94], ["SWMS", 98], ["PPE Compliance", 95]] as [string, number][]).map(([l, v]) => (<div key={l}><div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, marginBottom: 2 }}><span style={{ color: "var(--fg-3)" }}>{l}</span><span className="fs-tnum" style={{ fontWeight: 700, color: "var(--fg-1)" }}>{v}%</span></div><Bar value={v} color="var(--success)" height={3} /></div>))}</div></div></Card>
      </div>
    </div>
  );
}
