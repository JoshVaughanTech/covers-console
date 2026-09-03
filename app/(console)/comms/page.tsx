"use client";

import { useMemo, useState } from "react";
import {
  Card,
  Bar,
  Avatar,
  AvatarStack,
  Badge,
  Button,
  Check,
  Icon,
  STATUS,
  Modal,
  Field,
  TextField,
  TextArea,
  Select,
  useToast,
} from "@/components/ui";
import type { Tone } from "@/lib/status";
import { PageHead, CardHead, LinkBtn } from "@/components/screen/page-head";

type Channel = "Overview" | "Brief" | "Chat" | "Tasks" | "Files" | "Handover";

interface Msg {
  id: number;
  name: string;
  supervisor: boolean;
  text: string;
  time: string;
  reactions: { emoji: string; count: number }[];
}

interface AckPerson {
  name: string;
  status: string;
  ackd: boolean;
}

interface TaskItem {
  label: string;
  done: boolean;
}

interface Room {
  id: string;
  name: string;
  site: string;
  ago: string;
  unread: number;
  icon: string;
  live: boolean;
  time: string;
  jobNo: string;
  pinned: string;
  messages: Msg[];
}

const CHANNELS: Channel[] = ["Overview", "Brief", "Chat", "Tasks", "Files", "Handover"];

const CANDIDATES = [
  "Ana Reed",
  "Ben Cole",
  "Cara Vu",
  "Dan Ortiz",
  "Ella Mason",
  "Finn Webb",
];

function nowTime(): string {
  const d = new Date();
  let h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, "0");
  const ampm = h >= 12 ? "pm" : "am";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${m} ${ampm}`;
}

function seedMessages(intro: string): Msg[] {
  return [
    {
      id: 1,
      name: "Jason Miller",
      supervisor: true,
      text: intro,
      time: "6:32 pm",
      reactions: [
        { emoji: "👍", count: 4 },
        { emoji: "✓", count: 2 },
      ],
    },
    {
      id: 2,
      name: "Sophie Nguyen",
      supervisor: false,
      text: "Acknowledged. I'll be on Gate 2 from 6pm.",
      time: "6:35 pm",
      reactions: [{ emoji: "👍", count: 1 }],
    },
    {
      id: 3,
      name: "Liam Patel",
      supervisor: false,
      text: "Radio check complete on Channel 3.",
      time: "6:36 pm",
      reactions: [],
    },
    {
      id: 4,
      name: "Jason Miller",
      supervisor: true,
      text: "Reminder: Bag checks are mandatory. Report any incidents via the Issue Report button.",
      time: "6:38 pm",
      reactions: [],
    },
  ];
}

const INITIAL_ROOMS: Room[] = [
  {
    id: "r1",
    name: "Brightwater — Friday Live",
    site: "Brightwater Hotel · Main Bar",
    ago: "2m",
    unread: 12,
    icon: "building-2",
    live: false,
    time: "Today, 3:00pm – 12:00am",
    jobNo: "FN-2035",
    pinned: "Band on at 8pm — bar fully stocked and RSA sign-on complete by 3:45pm.",
    messages: seedMessages("Afternoon team — doors at 4, band on at 8. Confirm your RSA sign-on before service."),
  },
  {
    id: "r2",
    name: "Werribee Wedding — Event Crew",
    site: "Werribee Park Mansion · Marquee",
    ago: "5m",
    unread: 8,
    icon: "shield",
    live: true,
    time: "Today, 6:00pm – 2:00am",
    jobNo: "FN-2041",
    pinned: "Access change: staff park at the service gate from 6pm. Full details in the run sheet.",
    messages: seedMessages(
      "Team, guests arrive 6pm. Please review the run sheet and check your section. Let me know if you have any questions."
    ),
  },
  {
    id: "r3",
    name: "Northside — Kitchen & Floor",
    site: "Northside Tavern · Bistro",
    ago: "18m",
    unread: 3,
    icon: "briefcase",
    live: false,
    time: "Today, 10:00am – 6:00pm",
    jobNo: "FN-2033",
    pinned: "Deliveries via the rear laneway only. Cool room to be logged after each run.",
    messages: seedMessages("Kitchen — produce delivery lands 10am. Stage it in the cool room and log temps."),
  },
  {
    id: "r4",
    name: "All Venues — Ops",
    site: "All Venues",
    ago: "1h",
    unread: 2,
    icon: "wrench",
    live: false,
    time: "Today, 6:00am – 2:00pm",
    jobNo: "FN-2055",
    pinned: "Log cellar and cool-room temps in the compliance tracker before clocking off.",
    messages: seedMessages("Cellar checks start at 6. Keg lines and glasswasher are the priority this morning."),
  },
];

const INITIAL_ACK: AckPerson[] = [
  { name: "Jason Miller (You)", status: "Ack'd 6:10pm", ackd: true },
  { name: "Sophie Nguyen", status: "Ack'd 6:12pm", ackd: true },
  { name: "Liam Patel", status: "Ack'd 6:12pm", ackd: true },
  { name: "Priya Shah", status: "Pending", ackd: false },
];

const INITIAL_TASKS: TaskItem[] = [
  { label: "Collect radios from comms room", done: true },
  { label: "Confirm all positions staffed", done: true },
  { label: "Brief casuals on bag-check procedure", done: false },
  { label: "Test emergency PA system", done: false },
  { label: "Submit end-of-shift incident log", done: false },
];

const FILES: [string, string, string, string][] = [
  ["Run Sheet – Werribee Wedding.pdf", "PDF · 1.4 MB", "file-text", "Jason Miller"],
  ["Floor Plan – Main Floor.png", "Image · 820 KB", "image", "Ops Team"],
  ["Emergency Procedures.docx", "Doc · 240 KB", "file-text", "HSE"],
  ["Roster – Tonight.xlsx", "Sheet · 96 KB", "table", "Scheduling"],
];

const HANDOVER: [string, string, string][] = [
  ["Day Shift Handover", "All gates staffed. Gate 3 turnstile sticking — flagged to maintenance.", "Marco Diaz · 5:55pm"],
  ["Incident Note", "Minor crowd surge near bar 2 at 8:40pm, resolved within 5 mins.", "Sophie Nguyen · 8:46pm"],
  ["Equipment", "2 radios returned with low battery, swapped from spares.", "Liam Patel · 9:10pm"],
];

const REACTION_PALETTE = ["👍", "✓", "🙌", "🚀", "❤️"];

export default function CommsPage() {
  const [rooms, setRooms] = useState<Room[]>(INITIAL_ROOMS);
  const [activeId, setActiveId] = useState<string>("r2");
  const [channel, setChannel] = useState<Channel>("Chat");
  const [draft, setDraft] = useState("");

  const [ack, setAck] = useState<AckPerson[]>(INITIAL_ACK);
  const [tasks, setTasks] = useState<TaskItem[]>(INITIAL_TASKS);
  const [openIssues, setOpenIssues] = useState(2);

  // Create-room modal
  const [roomOpen, setRoomOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newSite, setNewSite] = useState("");
  const [newTime, setNewTime] = useState("");

  // Add-people modal
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [picked, setPicked] = useState<Record<string, boolean>>({});

  // Issue modal
  const [issueOpen, setIssueOpen] = useState(false);
  const [issueTitle, setIssueTitle] = useState("");
  const [issueSeverity, setIssueSeverity] = useState("medium");
  const [issueDesc, setIssueDesc] = useState("");

  const toast = useToast();

  const active = useMemo(
    () => rooms.find((r) => r.id === activeId) ?? rooms[0],
    [rooms, activeId]
  );

  const ackTotal = 11;
  const ackBase = 9 - INITIAL_ACK.filter((a) => a.ackd).length; // others already counted toward 9/11
  const ackdCount = ackBase + ack.filter((a) => a.ackd).length;
  const ackPct = Math.round((ackdCount / ackTotal) * 100);

  const overview: [string, string, string, string, Tone][] = [
    ["Unread Messages", "18", "+6 new", "message-square", "info"],
    ["Urgent Alerts", "3", "Requires attention", "triangle-alert", "danger"],
    ["Pending Acknowledgements", "12", "Event briefs & announcements", "clipboard-check", "warning"],
    ["Handover Notes", "7", "Awaiting review", "notebook-pen", "teal"],
  ];

  const instr = [
    "Arrive 15 mins early for briefing",
    "Wear full uniform & ID at all times",
    "Sign the RSA register before service",
    "Report incidents immediately",
  ];

  function selectRoom(id: string) {
    setActiveId(id);
    setChannel("Chat");
    setDraft("");
  }

  function send() {
    const text = draft.trim();
    if (!text) return;
    setRooms((prev) =>
      prev.map((r) =>
        r.id === activeId
          ? {
              ...r,
              messages: [
                ...r.messages,
                {
                  id: Date.now(),
                  name: "Jason Miller (You)",
                  supervisor: true,
                  text,
                  time: nowTime(),
                  reactions: [],
                },
              ],
            }
          : r
      )
    );
    setDraft("");
  }

  function bumpReaction(msgId: number, emoji: string) {
    setRooms((prev) =>
      prev.map((r) => {
        if (r.id !== activeId) return r;
        return {
          ...r,
          messages: r.messages.map((m) => {
            if (m.id !== msgId) return m;
            const found = m.reactions.find((x) => x.emoji === emoji);
            if (found) {
              return {
                ...m,
                reactions: m.reactions.map((x) =>
                  x.emoji === emoji ? { ...x, count: x.count + 1 } : x
                ),
              };
            }
            return { ...m, reactions: [...m.reactions, { emoji, count: 1 }] };
          }),
        };
      })
    );
  }

  function acknowledge(name: string) {
    setAck((prev) =>
      prev.map((a) =>
        a.name === name ? { ...a, ackd: true, status: `Ack'd ${nowTime()}` } : a
      )
    );
    toast(`${name} acknowledged the brief`, { tone: "success", icon: "clipboard-check" });
  }

  function toggleTask(idx: number) {
    setTasks((prev) => prev.map((t, i) => (i === idx ? { ...t, done: !t.done } : t)));
  }

  function createRoom() {
    const name = newName.trim();
    if (!name) {
      toast("Enter a room name", { tone: "warning", icon: "triangle-alert" });
      return;
    }
    const id = `r${Date.now()}`;
    const site = newSite.trim() || "Location TBC";
    const time = newTime.trim() || "Time TBC";
    const room: Room = {
      id,
      name,
      site,
      ago: "now",
      unread: 0,
      icon: "building-2",
      live: false,
      time,
      jobNo: `FN-${Math.floor(2000 + Math.random() * 999)}`,
      pinned: "New room created. Add a pinned brief to get started.",
      messages: [
        {
          id: Date.now(),
          name: "Jason Miller (You)",
          supervisor: true,
          text: `${name} room created. Welcome aboard — review the brief before shift start.`,
          time: nowTime(),
          reactions: [],
        },
      ],
    };
    setRooms((prev) => [room, ...prev]);
    setActiveId(id);
    setChannel("Chat");
    setRoomOpen(false);
    setNewName("");
    setNewSite("");
    setNewTime("");
    toast(`Function room "${name}" created`, { tone: "success", icon: "circle-check" });
  }

  function addPeople() {
    const chosen = CANDIDATES.filter((c) => picked[c]);
    if (chosen.length === 0) {
      toast("Select at least one person", { tone: "warning", icon: "triangle-alert" });
      return;
    }
    setPeopleOpen(false);
    setPicked({});
    toast(`${chosen.length} added to ${active.name}`, { tone: "success", icon: "user-plus" });
  }

  function reportIssue() {
    const title = issueTitle.trim();
    if (!title) {
      toast("Add an issue title", { tone: "warning", icon: "triangle-alert" });
      return;
    }
    setOpenIssues((n) => n + 1);
    setIssueOpen(false);
    setIssueTitle("");
    setIssueSeverity("medium");
    setIssueDesc("");
    toast(`Issue reported: ${title}`, { tone: "danger", icon: "triangle-alert" });
  }

  const pickedCount = CANDIDATES.filter((c) => picked[c]).length;

  return (
    <div>
      <PageHead title="Communications" sub="Event and venue communication, real-time updates and accountability." />
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
                    <LinkBtn onClick={() => toast(`${o[0]} — opening full list`, { tone: "info" })}>View all</LinkBtn>
                  </div>
                );
              })}
            </div>
          </Card>
          <Card pad={16}>
            <CardHead title="Active Function Rooms" right={<LinkBtn onClick={() => toast("Showing all function rooms", { tone: "info" })}>View all rooms</LinkBtn>} />
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {rooms.map((r) => {
                const isActive = r.id === activeId;
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => selectRoom(r.id)}
                    style={{ textAlign: "left", cursor: "pointer", font: "inherit", display: "flex", alignItems: "center", gap: 10, padding: "8px 9px", borderRadius: 10, background: isActive ? "var(--fs-teal-tint)" : "transparent", border: isActive ? "1px solid var(--fs-teal-tint-2)" : "1px solid transparent" }}
                  >
                    <span style={{ width: 32, height: 32, borderRadius: 8, background: isActive ? "#fff" : "var(--bg-2)", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Icon name={r.icon} size={16} color="var(--fs-teal)" /></span>
                    <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--fg-1)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.name}</div><div style={{ fontSize: 10.5, color: "var(--fg-4)" }}>{r.site}</div></div>
                    <span style={{ fontSize: 10, color: "var(--fg-4)" }}>{r.ago}</span>
                    {r.unread > 0 && <span style={{ background: "var(--fs-teal)", color: "#fff", fontSize: 10, fontWeight: 700, minWidth: 18, height: 18, borderRadius: 999, display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "0 5px" }}>{r.unread}</span>}
                  </button>
                );
              })}
            </div>
            <Button variant="sec" size="sm" icon="plus" style={{ width: "100%", marginTop: 12 }} onClick={() => setRoomOpen(true)}>Create Function Room</Button>
          </Card>
        </div>

        {/* CENTER — chat */}
        <Card pad={0} style={{ display: "flex", flexDirection: "column", minHeight: 620 }}>
          <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
            <div style={{ fontSize: 11.5, color: "var(--fg-4)", display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>Function Rooms <Icon name="chevron-right" size={12} /> <span style={{ color: "var(--fs-teal)", fontWeight: 600 }}>{active.name}</span></div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <h3 style={{ margin: 0, fontSize: 20 }}>{active.name}</h3>
              {active.live && <Badge tone="success" dot>Live</Badge>}
              <div style={{ flex: 1 }} />
              <Button variant="sec" size="sm" icon="user-plus" onClick={() => setPeopleOpen(true)}>Add People</Button>
              <Button variant="sec" size="sm" style={{ padding: "7px 9px" }} onClick={() => toast("Room options", { tone: "info" })}><Icon name="more-horizontal" size={16} /></Button>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 12, color: "var(--fg-3)", marginTop: 7 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><Icon name="map-pin" size={13} color="var(--fg-4)" />{active.site}</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><Icon name="clock" size={13} color="var(--fg-4)" />{active.time}</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><Icon name="hash" size={13} color="var(--fg-4)" />Event #{active.jobNo}</span>
            </div>
            <div style={{ display: "flex", gap: 18, marginTop: 12, fontSize: 13 }}>
              {CHANNELS.map((t) => {
                const on = t === channel;
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setChannel(t)}
                    style={{ cursor: "pointer", border: 0, background: "transparent", font: "inherit", fontSize: 13, fontWeight: on ? 700 : 600, color: on ? "var(--fs-teal)" : "var(--fg-4)", paddingBottom: 8, borderBottom: on ? "2px solid var(--fs-teal)" : "2px solid transparent" }}
                  >
                    {t}
                  </button>
                );
              })}
            </div>
          </div>

          {channel === "Chat" && (
            <>
              <div style={{ flex: 1, padding: 18, background: "var(--bg)", display: "flex", flexDirection: "column", gap: 14 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 9, background: "var(--fs-teal-tint)", border: "1px solid var(--fs-teal-tint-2)", borderRadius: 10, padding: "9px 12px" }}>
                  <Icon name="pin" size={14} color="var(--fs-teal-700)" /><span style={{ fontSize: 12, color: "var(--fs-teal-700)", flex: 1 }}><b>Pinned</b> · {active.pinned}</span><LinkBtn onClick={() => setChannel("Brief")}>View brief</LinkBtn>
                </div>
                {active.messages.map((m) => (
                  <div key={m.id} style={{ display: "flex", gap: 10 }}>
                    <Avatar name={m.name.replace(" (You)", "")} size={32} />
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 3 }}><span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--fg-1)" }}>{m.name}</span>{m.supervisor && <Badge tone="teal" style={{ padding: "1px 7px", fontSize: 10 }}>Duty Manager</Badge>}<span style={{ fontSize: 11, color: "var(--fg-4)" }}>{m.time}</span></div>
                      <div style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, padding: "9px 13px", fontSize: 13, color: "var(--fg-2)", maxWidth: 460, lineHeight: 1.45 }}>{m.text}</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 5 }}>
                        {m.reactions.map((r) => (
                          <button
                            key={r.emoji}
                            type="button"
                            onClick={() => bumpReaction(m.id, r.emoji)}
                            style={{ cursor: "pointer", fontSize: 11, background: "#fff", border: "1px solid var(--border)", borderRadius: 999, padding: "2px 8px", color: "var(--fg-3)", font: "inherit" }}
                          >
                            {r.emoji} {r.count}
                          </button>
                        ))}
                        <button
                          type="button"
                          aria-label="Add reaction"
                          onClick={() => bumpReaction(m.id, REACTION_PALETTE[(m.reactions.length) % REACTION_PALETTE.length])}
                          style={{ cursor: "pointer", width: 22, height: 22, display: "inline-flex", alignItems: "center", justifyContent: "center", background: "#fff", border: "1px solid var(--border)", borderRadius: 999, color: "var(--fg-4)" }}
                        >
                          <Icon name="smile-plus" size={13} />
                        </button>
                      </div>
                    </div>
                    {m.supervisor && <Icon name="check-check" size={15} color="var(--success)" />}
                  </div>
                ))}
              </div>
              <div style={{ padding: "12px 16px", borderTop: "1px solid var(--border)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 11, padding: "10px 14px" }}>
                  <input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        send();
                      }
                    }}
                    placeholder="Type a message…"
                    aria-label="Message"
                    style={{ flex: 1, fontSize: 13, color: "var(--fg-1)", background: "transparent", border: 0, outline: "none", font: "inherit" }}
                  />
                  <button type="button" aria-label="Attach" onClick={() => toast("Attach file", { tone: "info", icon: "paperclip" })} style={{ border: 0, background: "transparent", cursor: "pointer", padding: 0, display: "inline-flex" }}><Icon name="paperclip" size={16} color="var(--fg-4)" /></button>
                  <button type="button" aria-label="Emoji" onClick={() => setDraft((d) => d + " 👍")} style={{ border: 0, background: "transparent", cursor: "pointer", padding: 0, display: "inline-flex" }}><Icon name="smile" size={16} color="var(--fg-4)" /></button>
                  <button type="button" aria-label="Mention" onClick={() => setDraft((d) => d + " @")} style={{ border: 0, background: "transparent", cursor: "pointer", padding: 0, display: "inline-flex" }}><Icon name="at-sign" size={16} color="var(--fg-4)" /></button>
                  <button
                    type="button"
                    aria-label="Send"
                    onClick={send}
                    style={{ width: 30, height: 30, borderRadius: 8, background: "var(--fs-teal)", border: 0, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center" }}
                  >
                    <Icon name="send" size={15} color="#fff" />
                  </button>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 9 }}><span style={{ fontSize: 11.5, color: "var(--fg-4)" }}>Read by 9 of 11</span><AvatarStack names={["Jason Miller", "Sophie Nguyen", "Liam Patel", "Priya Shah", "Ana Reed", "Ben Cole"]} size={20} max={6} extra={4} /></div>
              </div>
            </>
          )}

          {channel === "Overview" && (
            <div style={{ flex: 1, padding: 18, background: "var(--bg)", display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ fontSize: 13, color: "var(--fg-3)", lineHeight: 1.5 }}>Summary for <b style={{ color: "var(--fg-1)" }}>{active.name}</b>.</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                {([
                  ["Messages", `${active.messages.length}`, "message-square", "info" as Tone],
                  ["Acknowledged", `${ackdCount}/${ackTotal}`, "clipboard-check", "success" as Tone],
                  ["Open Issues", `${openIssues}`, "triangle-alert", "danger" as Tone],
                ] as [string, string, string, Tone][]).map((s) => {
                  const [bg, fg] = STATUS[s[3]];
                  return (
                    <div key={s[0]} style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, padding: 14 }}>
                      <span style={{ width: 34, height: 34, borderRadius: 9, background: bg, display: "inline-flex", alignItems: "center", justifyContent: "center" }}><Icon name={s[2]} size={16} color={fg} /></span>
                      <div className="fs-tnum" style={{ fontSize: 22, fontWeight: 800, color: "var(--fg-1)", marginTop: 8 }}>{s[1]}</div>
                      <div style={{ fontSize: 12, color: "var(--fg-4)", fontWeight: 600 }}>{s[0]}</div>
                    </div>
                  );
                })}
              </div>
              <div style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, padding: 14 }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--fg-1)", marginBottom: 6 }}>Shift details</div>
                <div style={{ fontSize: 12.5, color: "var(--fg-3)" }}>{active.site} · {active.time} · Event #{active.jobNo}</div>
              </div>
            </div>
          )}

          {channel === "Brief" && (
            <div style={{ flex: 1, padding: 18, background: "var(--bg)", display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 9, background: "var(--fs-teal-tint)", border: "1px solid var(--fs-teal-tint-2)", borderRadius: 10, padding: "11px 13px" }}>
                <Icon name="pin" size={15} color="var(--fs-teal-700)" /><span style={{ fontSize: 13, color: "var(--fs-teal-700)", flex: 1, lineHeight: 1.5 }}><b>Pinned brief</b> · {active.pinned}</span>
              </div>
              <div style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, padding: 16 }}>
                <h4 style={{ margin: "0 0 10px", fontSize: 14 }}>Venue & Site Instructions</h4>
                <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>{instr.map((t) => <Check key={t}>{t}</Check>)}</div>
              </div>
            </div>
          )}

          {channel === "Tasks" && (
            <div style={{ flex: 1, padding: 18, background: "var(--bg)" }}>
              <div style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, padding: 16, display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ fontSize: 12.5, color: "var(--fg-4)", marginBottom: 6 }}>{tasks.filter((t) => t.done).length} of {tasks.length} complete</div>
                {tasks.map((t, i) => (
                  <button
                    key={t.label}
                    type="button"
                    onClick={() => toggleTask(i)}
                    className="hov-row"
                    style={{ cursor: "pointer", textAlign: "left", border: 0, background: "transparent", font: "inherit", display: "flex", alignItems: "center", gap: 10, padding: "8px 6px", borderRadius: 8 }}
                  >
                    <span style={{ width: 18, height: 18, borderRadius: 5, border: t.done ? "0" : "1.5px solid var(--border-2)", background: t.done ? "var(--success)" : "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{t.done && <Icon name="check" size={12} color="#fff" />}</span>
                    <span style={{ fontSize: 13, color: t.done ? "var(--fg-4)" : "var(--fg-1)", textDecoration: t.done ? "line-through" : "none" }}>{t.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {channel === "Files" && (
            <div style={{ flex: 1, padding: 18, background: "var(--bg)" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {FILES.map((f) => (
                  <div key={f[0]} className="hov-row" style={{ display: "flex", alignItems: "center", gap: 11, background: "#fff", border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px" }}>
                    <span style={{ width: 34, height: 34, borderRadius: 9, background: "var(--fs-teal-tint)", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Icon name={f[2]} size={16} color="var(--fs-teal-700)" /></span>
                    <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 13, fontWeight: 600, color: "var(--fg-1)" }}>{f[0]}</div><div style={{ fontSize: 11, color: "var(--fg-4)" }}>{f[1]} · {f[3]}</div></div>
                    <button type="button" aria-label={`Download ${f[0]}`} onClick={() => toast(`Downloading ${f[0]}`, { tone: "info", icon: "download" })} style={{ border: 0, background: "transparent", cursor: "pointer", padding: 6, display: "inline-flex", borderRadius: 8 }}><Icon name="download" size={16} color="var(--fg-3)" /></button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {channel === "Handover" && (
            <div style={{ flex: 1, padding: 18, background: "var(--bg)", display: "flex", flexDirection: "column", gap: 10 }}>
              {HANDOVER.map((h) => (
                <div key={h[0]} style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, padding: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}><Icon name="notebook-pen" size={15} color="var(--fs-teal)" /><span style={{ fontSize: 13, fontWeight: 700, color: "var(--fg-1)" }}>{h[0]}</span></div>
                  <div style={{ fontSize: 13, color: "var(--fg-2)", lineHeight: 1.5 }}>{h[1]}</div>
                  <div style={{ fontSize: 11, color: "var(--fg-4)", marginTop: 7 }}>{h[2]}</div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* RIGHT */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Card pad={16}>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}><h4 style={{ margin: 0, fontSize: 14.5, flex: 1 }}>Assigned Team (11)</h4><LinkBtn onClick={() => toast("Viewing assigned team", { tone: "info" })}>View all</LinkBtn></div>
            <AvatarStack names={["Jason Miller", "Sophie Nguyen", "Liam Patel", "Priya Shah", "Ana Reed", "Ben Cole", "Cara Vu"]} size={32} max={6} extra={6} />
            <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
              <div style={{ fontSize: 11, color: "var(--fg-4)", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 8 }}>Duty Manager</div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}><Avatar name="Jason Miller" size={34} /><div style={{ flex: 1 }}><div style={{ fontSize: 13, fontWeight: 700, color: "var(--fg-1)" }}>Jason Miller</div><div className="fs-tnum" style={{ fontSize: 11, color: "var(--fg-4)" }}>0401 234 567</div></div><button type="button" aria-label="Call supervisor" onClick={() => toast("Calling Jason Miller", { tone: "teal", icon: "phone" })} style={{ border: 0, background: "transparent", cursor: "pointer", padding: 4, display: "inline-flex" }}><Icon name="phone" size={16} color="var(--fs-teal)" /></button></div>
            </div>
          </Card>
          <Card pad={16}>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 4 }}><h4 style={{ margin: 0, fontSize: 14, flex: 1 }}>Event Brief Acknowledgement</h4></div>
            <div style={{ fontSize: 11.5, color: "var(--fg-3)", marginBottom: 8 }}>{ackdCount} / {ackTotal} acknowledged</div>
            <Bar value={ackPct} color="var(--success)" />
            <div style={{ display: "flex", flexDirection: "column", gap: 9, marginTop: 12 }}>
              {ack.map((a) => (
                <div key={a.name} style={{ display: "flex", alignItems: "center", gap: 9 }}>
                  <Avatar name={a.name.replace(" (You)", "")} size={24} />
                  <span style={{ flex: 1, fontSize: 12, fontWeight: 500, color: "var(--fg-1)" }}>{a.name}</span>
                  {a.ackd ? (
                    <span style={{ fontSize: 11, fontWeight: 600, color: "var(--success-fg)" }}>{a.status.replace("Ack'd", "Ack’d")}</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => acknowledge(a.name)}
                      style={{ cursor: "pointer", fontSize: 11, fontWeight: 700, color: "var(--fs-teal-700)", background: "var(--fs-teal-tint)", border: "1px solid var(--fs-teal-tint-2)", borderRadius: 999, padding: "3px 10px" }}
                    >
                      Acknowledge
                    </button>
                  )}
                </div>
              ))}
            </div>
            <LinkBtn onClick={() => toast("Showing all acknowledgements", { tone: "info" })}>+ 7 more</LinkBtn>
          </Card>
          <Card pad={16}>
            <h4 style={{ margin: "0 0 10px", fontSize: 14 }}>Venue & Site Instructions</h4>
            <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>{instr.map((t) => <Check key={t}>{t}</Check>)}</div>
            <Button variant="sec" size="sm" style={{ width: "100%", marginTop: 12 }} onClick={() => setChannel("Brief")}>View full site instructions</Button>
          </Card>
          <Card pad={16}>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}><h4 style={{ margin: 0, fontSize: 14, flex: 1 }}>Issue Reporting</h4><span style={{ fontSize: 11, color: "var(--fg-4)" }}>{openIssues} open issues</span></div>
            <Button variant="danger" size="sm" icon="triangle-alert" style={{ width: "100%" }} onClick={() => setIssueOpen(true)}>Report an Issue</Button>
          </Card>
        </div>
      </div>

      {/* CREATE ROOM MODAL */}
      <Modal
        open={roomOpen}
        onClose={() => setRoomOpen(false)}
        title="Create Function Room"
        size="sm"
        footer={
          <>
            <Button variant="sec" size="sm" onClick={() => setRoomOpen(false)}>Cancel</Button>
            <Button variant="pri" size="sm" icon="plus" onClick={createRoom}>Create room</Button>
          </>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Field label="Room name">
            <TextField value={newName} onChange={setNewName} placeholder="e.g. Stadium Event Security" icon="users" />
          </Field>
          <Field label="Venue / site">
            <TextField value={newSite} onChange={setNewSite} placeholder="e.g. Olympic Park · Gate 4" icon="map-pin" />
          </Field>
          <Field label="Shift time">
            <TextField value={newTime} onChange={setNewTime} placeholder="e.g. Today, 5:00pm – 1:00am" icon="clock" />
          </Field>
        </div>
      </Modal>

      {/* ADD PEOPLE MODAL */}
      <Modal
        open={peopleOpen}
        onClose={() => setPeopleOpen(false)}
        title={`Add People to ${active.name}`}
        size="sm"
        footer={
          <>
            <Button variant="sec" size="sm" onClick={() => setPeopleOpen(false)}>Cancel</Button>
            <Button variant="pri" size="sm" icon="user-plus" onClick={addPeople}>Add{pickedCount > 0 ? ` ${pickedCount}` : ""}</Button>
          </>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {CANDIDATES.map((c) => {
            const on = !!picked[c];
            return (
              <button
                key={c}
                type="button"
                onClick={() => setPicked((p) => ({ ...p, [c]: !p[c] }))}
                className="hov-row"
                style={{ cursor: "pointer", textAlign: "left", border: "1px solid var(--border)", background: on ? "var(--fs-teal-tint)" : "#fff", font: "inherit", display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 10 }}
              >
                <Avatar name={c} size={28} />
                <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: "var(--fg-1)" }}>{c}</span>
                <span style={{ width: 18, height: 18, borderRadius: 5, border: on ? "0" : "1.5px solid var(--border-2)", background: on ? "var(--fs-teal)" : "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{on && <Icon name="check" size={12} color="#fff" />}</span>
              </button>
            );
          })}
        </div>
      </Modal>

      {/* REPORT ISSUE MODAL */}
      <Modal
        open={issueOpen}
        onClose={() => setIssueOpen(false)}
        title="Report an Issue"
        size="sm"
        footer={
          <>
            <Button variant="sec" size="sm" onClick={() => setIssueOpen(false)}>Cancel</Button>
            <Button variant="danger" size="sm" icon="triangle-alert" onClick={reportIssue}>Submit report</Button>
          </>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Field label="Issue title">
            <TextField value={issueTitle} onChange={setIssueTitle} placeholder="e.g. Faulty turnstile at Gate 3" icon="triangle-alert" />
          </Field>
          <Field label="Severity">
            <Select
              value={issueSeverity}
              onChange={setIssueSeverity}
              options={[
                { label: "Low", value: "low" },
                { label: "Medium", value: "medium" },
                { label: "High", value: "high" },
                { label: "Critical", value: "critical" },
              ]}
            />
          </Field>
          <Field label="Description">
            <TextArea value={issueDesc} onChange={setIssueDesc} rows={4} placeholder="Describe what happened, where, and any action taken…" />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
