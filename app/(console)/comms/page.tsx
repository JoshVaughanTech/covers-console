"use client";

import { Card, Bar, Avatar, AvatarStack, Badge, Button, Check, Icon, STATUS } from "@/components/ui";
import type { Tone } from "@/lib/status";
import { PageHead, CardHead, LinkBtn } from "@/components/screen/page-head";

interface Msg {
  name: string;
  supervisor: boolean;
  text: string;
  time: string;
  reactions: string[] | null;
}

export default function CommsPage() {
  const overview: [string, string, string, string, Tone][] = [
    ["Unread Messages", "18", "+6 new", "message-square", "info"],
    ["Urgent Alerts", "3", "Requires attention", "triangle-alert", "danger"],
    ["Pending Acknowledgements", "12", "Job briefs & announcements", "clipboard-check", "warning"],
    ["Handover Notes", "7", "Awaiting review", "notebook-pen", "teal"],
  ];
  const rooms: [string, string, string, number, string, boolean][] = [
    ["Commercial Build – Level 3", "Barangaroo South · Tower B", "2m", 12, "building-2", false],
    ["Crown Event Security", "Crown Sydney · Main Floor", "5m", 8, "shield", true],
    ["Retail Fitout – Level 1", "Chadstone · Zone A", "18m", 3, "briefcase", false],
    ["Maintenance – Site Wide", "Multiple Locations", "1h", 2, "wrench", false],
  ];
  const msgs: Msg[] = [
    { name: "Jason Miller", supervisor: true, text: "Team, doors open at 6pm. Please review the brief and check your positions. Let me know if you have any questions.", time: "6:32 pm", reactions: ["👍 4", "✓ 2"] },
    { name: "Sophie Nguyen", supervisor: false, text: "Acknowledged. I'll be on Gate 2 from 6pm.", time: "6:35 pm", reactions: ["👍 1"] },
    { name: "Liam Patel", supervisor: false, text: "Radio check complete on Channel 3.", time: "6:36 pm", reactions: null },
    { name: "Jason Miller", supervisor: true, text: "Reminder: Bag checks are mandatory. Report any incidents via the Issue Report button.", time: "6:38 pm", reactions: null },
  ];
  const ack: [string, string, boolean][] = [
    ["Jason Miller (You)", "Ack'd 6:10pm", true],
    ["Sophie Nguyen", "Ack'd 6:12pm", true],
    ["Liam Patel", "Ack'd 6:12pm", true],
    ["Priya Shah", "Pending", false],
  ];
  const instr = [
    "Arrive 15 mins early for briefing",
    "Wear full uniform & ID at all times",
    "Use Staff Entry B after 6pm",
    "Report incidents immediately",
  ];

  return (
    <div>
      <PageHead title="Communications" sub="Job-based communication, real-time updates and accountability." />
      <div style={{ display: "grid", gridTemplateColumns: "300px 1fr 318px", gap: 16, alignItems: "start" }}>
        {/* LEFT */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Card pad={16}>
            <CardHead title="Communications Overview" />
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {overview.map((o, i) => {
                const [bg, fg] = STATUS[o[4]];
                return (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 11 }}>
                    <span style={{ width: 38, height: 38, borderRadius: 10, background: bg, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Icon name={o[3]} size={18} color={fg} /></span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 7 }}><span className="fs-tnum" style={{ fontSize: 20, fontWeight: 800, color: "var(--fg-1)" }}>{o[1]}</span><span style={{ fontSize: 11, color: o[4] === "danger" ? "var(--danger-fg)" : "var(--fg-4)" }}>{o[2]}</span></div>
                      <div style={{ fontSize: 12, color: "var(--fg-3)", fontWeight: 600 }}>{o[0]}</div>
                    </div>
                    <LinkBtn>View all</LinkBtn>
                  </div>
                );
              })}
            </div>
          </Card>
          <Card pad={16}>
            <CardHead title="Active Job Rooms" right={<LinkBtn>View all rooms</LinkBtn>} />
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {rooms.map((r, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 9px", borderRadius: 10, background: r[5] ? "var(--fs-teal-tint)" : "transparent", border: r[5] ? "1px solid var(--fs-teal-tint-2)" : "1px solid transparent" }}>
                  <span style={{ width: 32, height: 32, borderRadius: 8, background: r[5] ? "#fff" : "var(--bg-2)", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Icon name={r[4]} size={16} color="var(--fs-teal)" /></span>
                  <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--fg-1)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r[0]}</div><div style={{ fontSize: 10.5, color: "var(--fg-4)" }}>{r[1]}</div></div>
                  <span style={{ fontSize: 10, color: "var(--fg-4)" }}>{r[2]}</span>
                  <span style={{ background: "var(--fs-teal)", color: "#fff", fontSize: 10, fontWeight: 700, minWidth: 18, height: 18, borderRadius: 999, display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "0 5px" }}>{r[3]}</span>
                </div>
              ))}
            </div>
            <Button variant="sec" size="sm" icon="plus" style={{ width: "100%", marginTop: 12 }}>Create Job Room</Button>
          </Card>
        </div>

        {/* CENTER — chat */}
        <Card pad={0} style={{ display: "flex", flexDirection: "column", minHeight: 620 }}>
          <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
            <div style={{ fontSize: 11.5, color: "var(--fg-4)", display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>Job Rooms <Icon name="chevron-right" size={12} /> <span style={{ color: "var(--fs-teal)", fontWeight: 600 }}>Crown Event Security</span></div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <h3 style={{ margin: 0, fontSize: 20 }}>Crown Event Security</h3>
              <Badge tone="success" dot>Live</Badge>
              <div style={{ flex: 1 }} />
              <Button variant="sec" size="sm" icon="user-plus">Add People</Button>
              <Button variant="sec" size="sm" style={{ padding: "7px 9px" }}><Icon name="more-horizontal" size={16} /></Button>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 12, color: "var(--fg-3)", marginTop: 7 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><Icon name="map-pin" size={13} color="var(--fg-4)" />Crown Sydney · Main Floor</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><Icon name="clock" size={13} color="var(--fg-4)" />Today, 6:00pm – 2:00am</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><Icon name="hash" size={13} color="var(--fg-4)" />Job #J-48291</span>
            </div>
            <div style={{ display: "flex", gap: 18, marginTop: 12, fontSize: 13 }}>
              {["Overview", "Brief", "Chat", "Tasks", "Files", "Handover"].map((t, i) => <span key={t} style={{ fontWeight: i === 2 ? 700 : 600, color: i === 2 ? "var(--fs-teal)" : "var(--fg-4)", paddingBottom: 8, borderBottom: i === 2 ? "2px solid var(--fs-teal)" : 0 }}>{t}</span>)}
            </div>
          </div>
          <div style={{ flex: 1, padding: 18, background: "var(--bg)", display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 9, background: "var(--fs-teal-tint)", border: "1px solid var(--fs-teal-tint-2)", borderRadius: 10, padding: "9px 12px" }}>
              <Icon name="pin" size={14} color="var(--fs-teal-700)" /><span style={{ fontSize: 12, color: "var(--fs-teal-700)", flex: 1 }}><b>Pinned</b> · Site access change: Use Staff Entry B from 6pm tonight. Full details in Brief.</span><LinkBtn>View brief</LinkBtn>
            </div>
            {msgs.map((m, i) => (
              <div key={i} style={{ display: "flex", gap: 10 }}>
                <Avatar name={m.name} size={32} />
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 3 }}><span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--fg-1)" }}>{m.name}</span>{m.supervisor && <Badge tone="teal" style={{ padding: "1px 7px", fontSize: 10 }}>Supervisor</Badge>}<span style={{ fontSize: 11, color: "var(--fg-4)" }}>{m.time}</span></div>
                  <div style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, padding: "9px 13px", fontSize: 13, color: "var(--fg-2)", maxWidth: 460, lineHeight: 1.45 }}>{m.text}</div>
                  {m.reactions && <div style={{ display: "flex", gap: 6, marginTop: 5 }}>{m.reactions.map((r) => <span key={r} style={{ fontSize: 11, background: "#fff", border: "1px solid var(--border)", borderRadius: 999, padding: "2px 8px", color: "var(--fg-3)" }}>{r}</span>)}</div>}
                </div>
                {m.supervisor && <Icon name="check-check" size={15} color="var(--success)" />}
              </div>
            ))}
            <div style={{ fontSize: 11.5, color: "var(--fg-4)", textAlign: "center" }}>Priya Shah joined the room · 6:40 pm</div>
          </div>
          <div style={{ padding: "12px 16px", borderTop: "1px solid var(--border)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 11, padding: "10px 14px" }}>
              <span style={{ flex: 1, fontSize: 13, color: "var(--fg-4)" }}>Type a message…</span>
              <Icon name="paperclip" size={16} color="var(--fg-4)" /><Icon name="smile" size={16} color="var(--fg-4)" /><Icon name="at-sign" size={16} color="var(--fg-4)" />
              <span style={{ width: 30, height: 30, borderRadius: 8, background: "var(--fs-teal)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}><Icon name="send" size={15} color="#fff" /></span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 9 }}><span style={{ fontSize: 11.5, color: "var(--fg-4)" }}>Read by 9 of 11</span><AvatarStack names={["Jason Miller", "Sophie Nguyen", "Liam Patel", "Priya Shah", "Ana Reed", "Ben Cole"]} size={20} max={6} extra={4} /></div>
          </div>
        </Card>

        {/* RIGHT */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Card pad={16}>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}><h4 style={{ margin: 0, fontSize: 14.5, flex: 1 }}>Assigned Team (11)</h4><LinkBtn>View all</LinkBtn></div>
            <AvatarStack names={["Jason Miller", "Sophie Nguyen", "Liam Patel", "Priya Shah", "Ana Reed", "Ben Cole", "Cara Vu"]} size={32} max={6} extra={6} />
            <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
              <div style={{ fontSize: 11, color: "var(--fg-4)", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 8 }}>Supervisor</div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}><Avatar name="Jason Miller" size={34} /><div style={{ flex: 1 }}><div style={{ fontSize: 13, fontWeight: 700, color: "var(--fg-1)" }}>Jason Miller</div><div className="fs-tnum" style={{ fontSize: 11, color: "var(--fg-4)" }}>0401 234 567</div></div><Icon name="phone" size={16} color="var(--fs-teal)" /></div>
            </div>
          </Card>
          <Card pad={16}>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 4 }}><h4 style={{ margin: 0, fontSize: 14, flex: 1 }}>Job Brief Acknowledgement</h4></div>
            <div style={{ fontSize: 11.5, color: "var(--fg-3)", marginBottom: 8 }}>9 / 11 acknowledged</div>
            <Bar value={82} color="var(--success)" />
            <div style={{ display: "flex", flexDirection: "column", gap: 9, marginTop: 12 }}>
              {ack.map((a, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 9 }}><Avatar name={a[0].replace(" (You)", "")} size={24} /><span style={{ flex: 1, fontSize: 12, fontWeight: 500, color: "var(--fg-1)" }}>{a[0]}</span><span style={{ fontSize: 11, fontWeight: 600, color: a[2] ? "var(--success-fg)" : "var(--warning-fg)" }}>{a[1]}</span></div>
              ))}
            </div>
            <LinkBtn>+ 7 more</LinkBtn>
          </Card>
          <Card pad={16}>
            <h4 style={{ margin: "0 0 10px", fontSize: 14 }}>Site Instructions</h4>
            <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>{instr.map((t) => <Check key={t}>{t}</Check>)}</div>
            <Button variant="sec" size="sm" style={{ width: "100%", marginTop: 12 }}>View full site instructions</Button>
          </Card>
          <Card pad={16}>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}><h4 style={{ margin: 0, fontSize: 14, flex: 1 }}>Issue Reporting</h4><span style={{ fontSize: 11, color: "var(--fg-4)" }}>2 open issues</span></div>
            <Button variant="danger" size="sm" icon="triangle-alert" style={{ width: "100%" }}>Report an Issue</Button>
          </Card>
        </div>
      </div>
    </div>
  );
}
