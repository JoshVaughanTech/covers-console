"use client";

import { useEffect, useMemo, useState } from "react";
import { NotComputedBanner } from "@/components/screen/not-computed";
import {
  Card,
  Ring,
  Bar,
  Avatar,
  AvatarStack,
  Badge,
  Icon,
  Button,
  Menu,
  Modal,
  Field,
  TextField,
  Select,
  EmptyState,
  STATUS,
  useToast,
} from "@/components/ui";
import type { Tone } from "@/lib/status";
import { CardHead, LinkBtn } from "@/components/screen/page-head";

/* The card shape, the columns and the seed all live in lib/tasks now, because
   the API route folds the same types out of the audit chain. Two definitions
   of what a task is would be two things that can disagree about a board. */
import { BASE_EXTRA, COLS, cardInColumn, seedBoard, type ColName, type TaskBoard } from "@/lib/tasks";

const TABS = ["Dashboard", "Tasks", "Timeline", "Documents", "Team", "Issues", "Reports", "Settings"];

export default function ProjectsPage() {
  const toast = useToast();
  const [tab, setTab] = useState("Dashboard");

  /* ---- The board, as the chain says it stands ----

     Starts from the seed so the first paint is the same board the server will
     send, rather than an empty grid that fills in. /api/tasks then replaces it
     with the fold, and every mutation returns the fold too — so the screen and
     /audit cannot drift apart, which is the whole reason this is an event and
     not a row somebody updates. */
  const [board, setBoard] = useState<TaskBoard>(seedBoard);

  useEffect(() => {
    let live = true;
    fetch("/api/tasks")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (live && d?.board) setBoard(d.board);
      })
      .catch(() => {
        /* leaving the seed on screen is the honest failure: the board is
           readable and stale rather than blank, and the next move will fail
           loudly with a toast rather than silently disagreeing. */
      });
    return () => {
      live = false;
    };
  }, []);

  /* Base counts reflect the larger backlog beyond the few cards shown.
     We track the "extra" (non-card) tally per column so totals stay
     consistent when a card is added or moved. */
  const count = (c: ColName) => BASE_EXTRA[c] + board[c].length;
  const totalDone = count("Completed");
  const totalAll = COLS.reduce((s, c) => s + count(c), 0);

  const colTone: Record<ColName, Tone> = { "To Do": "neutral", "In Progress": "info", Review: "warning", Completed: "success" };
  const prio: Record<"High" | "Medium" | "Low", Tone> = { High: "danger", Medium: "warning", Low: "neutral" };

  const timeline: [string, string, boolean | "active"][] = [
    ["Enquiry & Quote", "May 1", true],
    ["Site Inspection", "May 5", true],
    ["Menu Tasting", "May 10", true],
    ["Prep & Staffing", "May 12 – May 28", "active"],
    ["Event Day — Service", "May 30", false],
    ["Bump-out & Debrief", "May 31", false],
  ];
  const docs: [string, string][] = [
    ["Run Sheet – Werribee Wedding.pdf", "PDF · May 15, 2024 · v2.1"],
    ["Floor Plan & Table Layout.pdf", "PDF · May 14, 2024 · v1.3"],
    ["Dietary Requirements Schedule.xlsx", "XLSX · May 13, 2024 · v1.0"],
    ["Beverage Order – Confirmed.pdf", "PDF · May 12, 2024 · v1.0"],
  ];
  const team: [string, string, string][] = [
    ["Priya Sharma", "Events Coordinator", "32 hrs"],
    ["Hassan Ali", "Head Chef", "28 hrs"],
    ["Darie Roberts", "Bar Lead", "24 hrs"],
    ["Sophie Nguyen", "Venue Manager", "20 hrs"],
  ];
  const activity: [string, string, string, string, Tone][] = [
    ["Hassan Ali", "completed Allergen sign-off — plated main", "10:24 AM", "check-circle-2", "success"],
    ["Priya Sharma", "uploaded the final dietary schedule", "09:58 AM", "image", "info"],
    ["Darie Roberts", "raised an issue: Sparkling order short by 2 cases", "09:32 AM", "triangle-alert", "warning"],
    ["Sophie Nguyen", "updated task: Marquee bar setup", "09:15 AM", "edit-3", "teal"],
  ];

  const assigneeOptions = useMemo(
    () =>
      [...new Set(team.map((t) => t[0]).concat(["Ben Cole", "Ana Reed", "Cara Vu", "Eve Ho", "Gus Ray"]))].map((n) => ({
        label: n,
        value: n,
      })),
    // team is a stable literal; safe to compute once
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  /* ---- Add task modal ---- */
  const [addCol, setAddCol] = useState<ColName | null>(null);
  const [fTitle, setFTitle] = useState("");
  const [fSub, setFSub] = useState("");
  const [fPrio, setFPrio] = useState("Medium");
  const [fDue, setFDue] = useState("");
  const [fAssignee, setFAssignee] = useState("");

  const openAdd = (col: ColName) => {
    setAddCol(col);
    setFTitle("");
    setFSub("");
    setFPrio("Medium");
    setFDue("");
    setFAssignee("");
  };
  const closeAdd = () => setAddCol(null);

  const submitAdd = () => {
    if (!addCol) return;
    const title = fTitle.trim();
    if (!title) {
      toast("Task title is required", { tone: "warning", icon: "triangle-alert" });
      return;
    }
    const target = addCol;
    /* No optimistic insert here, unlike a move: the id is minted server-side so
       a card cannot be drawn before the chain has one. Accepting a client id
       would let a new task collide with a seeded one, and the fold would then
       skip the creation as already-present — losing it with no error. */
    void persist(
      {
        action: "create",
        to: target,
        card: {
          title,
          sub: fSub.trim() || "Unassigned location",
          prio: target === "Completed" ? null : fPrio,
          due: target === "Completed" ? "Completed today" : fDue.trim() || "No due date",
          names: fAssignee ? [fAssignee] : [],
        },
      },
      `Added “${title}” to ${target}`,
    );
    closeAdd();
  };

  /**
   * Send a change and take the server's board as the answer.
   *
   * The response is the fold, not an acknowledgement, so what ends up on screen
   * is what the chain says rather than what this component predicted. On
   * failure the previous board is restored and the toast says so — a move that
   * silently did not persist is the one outcome worth avoiding, because the
   * screen would then disagree with /audit and nothing would indicate which is
   * right.
   */
  async function persist(body: Record<string, unknown>, okMessage: string, rollback?: TaskBoard) {
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => null)) as { board?: TaskBoard; error?: string } | null;
      if (!res.ok) throw new Error(data?.error ?? `could not save (${res.status})`);
      if (data?.board) setBoard(data.board);
      toast(okMessage, { tone: "success", icon: "check-circle-2" });
    } catch (err) {
      if (rollback) setBoard(rollback);
      toast(err instanceof Error ? `Not saved — ${err.message}` : "Not saved", {
        tone: "danger",
        icon: "triangle-alert",
      });
    }
  }

  const moveCard = (from: ColName, id: string, to: ColName) => {
    if (from === to) return;
    const before = board;
    const card = board[from].find((c) => c.id === id);
    if (!card) return;

    /* Applied locally first, because a drag that waits for a round trip feels
       broken. persist() then replaces this with the server's fold, so the
       optimistic board is a prediction that is always corrected rather than a
       second source of truth — and cardInColumn is shared with the replay so
       the prediction and the correction agree about Completed. */
    setBoard((b) => ({
      ...b,
      [from]: b[from].filter((c) => c.id !== id),
      [to]: [cardInColumn(card, to), ...b[to]],
    }));

    void persist({ taskId: id, from, to }, `Moved to ${to}`, before);
  };

  /* ---- Dragging a card between columns ----

     An addition to the ⋮ menu rather than a replacement for it. Drag is a
     mouse-only gesture, and the menu is the path that works from a keyboard,
     so removing it to "simplify" would quietly drop a whole class of user.
     Both routes call moveCard(), so they cannot disagree about what a move
     does — the Completed column rewrites the card, and doing that in one
     place is why. */
  const [drag, setDrag] = useState<{ from: ColName; id: string } | null>(null);
  const [overCol, setOverCol] = useState<ColName | null>(null);

  /* ---- Verified sign-off modal ---- */
  const [signoffOpen, setSignoffOpen] = useState(false);
  const signoffs: [string, string, string, string][] = [
    ["Allergen sign-off — plated main", "Kitchen — 38 flagged guests", "Hassan Ali", "May 16, 2024"],
    ["Marquee bar setup", "Garden lawn", "Darie Roberts", "May 15, 2024"],
    ["Final dietary schedule", "Front of house", "Priya Sharma", "May 15, 2024"],
    ["Beverage order reconciliation", "Cellar", "Sophie Nguyen", "May 14, 2024"],
  ];

  const tabIsBoard = tab === "Tasks";

  /* ---- Reusable board renderer (compact in Dashboard, full-width in Tasks) ---- */
  const renderBoard = (cardCols = 4) => (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${cardCols},1fr)`, gap: tabIsBoard ? 14 : 10 }}>
      {COLS.map((col) => {
        const [bg, fg] = STATUS[colTone[col]];
        // only a drop target if a card is in flight and it did not start here
        const isTarget = Boolean(drag) && drag!.from !== col && overCol === col;
        return (
          <div
            key={col}
            onDragOver={(e) => {
              if (!drag) return;
              // without preventDefault the browser refuses the drop entirely
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              if (overCol !== col) setOverCol(col);
            }}
            onDragLeave={(e) => {
              // dragleave also fires when crossing onto a child, so ignore those
              if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
              setOverCol((o) => (o === col ? null : o));
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (drag) moveCard(drag.from, drag.id, col);
              setDrag(null);
              setOverCol(null);
            }}
            style={{ minWidth: 0 }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 8px", borderRadius: 7, background: bg, marginBottom: 8 }}>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: fg, flex: 1 }}>{col}</span>
              <span className="fs-tnum" style={{ fontSize: 11, fontWeight: 700, color: fg }}>{count(col)}</span>
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                borderRadius: 9,
                // minHeight so an empty column is still a target you can hit
                minHeight: 44,
                outline: isTarget ? `2px dashed ${fg}` : "2px dashed transparent",
                outlineOffset: 3,
                transition: "outline-color .12s ease",
              }}
            >
              {board[col].map((c) => {
                const others = COLS.filter((x) => x !== col);
                return (
                  <div
                    key={c.id}
                    draggable
                    onDragStart={(e) => {
                      setDrag({ from: col, id: c.id });
                      e.dataTransfer.effectAllowed = "move";
                      // Firefox will not start a drag without payload on the transfer
                      e.dataTransfer.setData("text/plain", c.id);
                    }}
                    onDragEnd={() => {
                      // fires on a cancelled drag too, so this is where cleanup belongs
                      setDrag(null);
                      setOverCol(null);
                    }}
                    style={{
                      border: "1px solid var(--border)",
                      borderRadius: 9,
                      padding: 9,
                      background: col === "Completed" ? "var(--surface-2)" : "#fff",
                      cursor: "grab",
                      opacity: drag?.id === c.id ? 0.4 : 1,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--fg-1)", lineHeight: 1.25 }}>{c.title}</div>
                        <div style={{ fontSize: 10, color: "var(--fg-4)", marginTop: 2 }}>{c.sub}</div>
                      </div>
                      <Menu
                        align="right"
                        items={others.map((dest) => ({
                          label: `Move to ${dest}`,
                          icon: "corner-up-right",
                          onClick: () => moveCard(col, c.id, dest),
                        }))}
                      >
                        <button
                          type="button"
                          aria-label={`Move ${c.title}`}
                          title="Move task"
                          style={{ border: 0, background: "transparent", cursor: "pointer", padding: 2, borderRadius: 6, color: "var(--fg-4)", display: "inline-flex" }}
                        >
                          <Icon name="ellipsis-vertical" size={14} />
                        </button>
                      </Menu>
                    </div>
                    {c.prio && (
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 7 }}>
                        <Badge tone={prio[c.prio]} style={{ fontSize: 9, padding: "2px 6px" }}>{c.prio}</Badge>
                        <span style={{ fontSize: 9.5, color: "var(--fg-4)", flex: 1 }}>{c.due}</span>
                        {c.names.length > 0 && <AvatarStack names={c.names} size={18} max={2} extra={c.extra} />}
                      </div>
                    )}
                    {col === "Completed" && (
                      <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 6 }}>
                        <Icon name="check-circle-2" size={12} color="var(--success)" />
                      </div>
                    )}
                  </div>
                );
              })}
              <button
                type="button"
                onClick={() => openAdd(col)}
                style={{ fontSize: 10.5, color: "var(--fg-4)", fontWeight: 600, padding: "4px 0", cursor: "pointer", border: 0, background: "transparent", textAlign: "left", font: "inherit" }}
              >
                + Add task
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );

  return (
    <div>
      <NotComputedBanner source="Covers records no run sheets. A shift knows its role, site and duties; nothing holds the tasks, timings or courses a service is run to." />
      <div style={{ display: "flex", alignItems: "flex-start", gap: 16, marginBottom: 18 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <h2 style={{ margin: 0, fontSize: 24 }}>Werribee Park Wedding — Run Sheet</h2>
            <Badge tone="success" dot>Active</Badge>
            <Icon name="star" size={17} color="var(--warning)" />
          </div>
          <p style={{ margin: "4px 0 0", fontSize: 14 }}>180 guests · Saturday service · Nguyen &amp; Cole</p>
          <div style={{ display: "flex", gap: 18, marginTop: 12, fontSize: 13 }}>
            {TABS.map((t) => {
              const active = t === tab;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  style={{
                    border: 0,
                    background: "transparent",
                    font: "inherit",
                    cursor: "pointer",
                    fontWeight: active ? 700 : 600,
                    color: active ? "var(--fs-teal)" : "var(--fg-4)",
                    paddingBottom: 6,
                    borderBottom: active ? "2px solid var(--fs-teal)" : "2px solid transparent",
                  }}
                >
                  {t}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ===================== DASHBOARD ===================== */}
      {tab === "Dashboard" && (
        <>
          {/* metric row */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 16, marginBottom: 16 }}>
            <Card pad={16}>
              <div style={{ fontSize: 12.5, color: "var(--fg-3)", fontWeight: 600, marginBottom: 6 }}>Tasks Completed</div>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <Ring value={Math.round((totalDone / totalAll) * 100)} label={`${Math.round((totalDone / totalAll) * 100)}%`} size={66} />
                <div>
                  <div className="fs-tnum" style={{ fontSize: 13, fontWeight: 700 }}>{totalDone} / {totalAll}</div>
                  <div style={{ fontSize: 11, color: "var(--success-fg)", marginTop: 2 }}>↑ 12% vs last 7 days</div>
                </div>
              </div>
            </Card>
            <Card pad={16}><div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ fontSize: 12.5, color: "var(--fg-3)", fontWeight: 600 }}>Open Issues</span><Icon name="shield-alert" size={16} color="var(--danger)" /></div><div className="fs-tnum" style={{ fontSize: 30, fontWeight: 800, margin: "4px 0 2px" }}>8</div><div style={{ fontSize: 11, color: "var(--fg-4)" }}>High: 2 · Medium: 6</div><div style={{ fontSize: 11, color: "var(--danger-fg)", marginTop: 4 }}>↓ 2 vs last 7 days</div></Card>
            <Card pad={16}><div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ fontSize: 12.5, color: "var(--fg-3)", fontWeight: 600 }}>Labour Hours</span><Icon name="clock" size={16} color="var(--fs-teal)" /></div><div className="fs-tnum" style={{ fontSize: 30, fontWeight: 800, margin: "4px 0 2px" }}>1,248<span style={{ fontSize: 14, color: "var(--fg-4)" }}> hrs</span></div><div style={{ fontSize: 11, color: "var(--success-fg)", marginTop: 4 }}>↑ 9% vs last 7 days</div></Card>
            <Card pad={16}><div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ fontSize: 12.5, color: "var(--fg-3)", fontWeight: 600 }}>Verified Sign-offs</span><Icon name="badge-check" size={16} color="var(--success)" /></div><div className="fs-tnum" style={{ fontSize: 30, fontWeight: 800, margin: "4px 0 2px" }}>36</div><div style={{ fontSize: 11, color: "var(--fg-4)" }}>This week</div><div style={{ fontSize: 11, color: "var(--success-fg)", marginTop: 4 }}>↑ 18% vs last 7 days</div></Card>
            <Card pad={16}><div style={{ fontSize: 12.5, color: "var(--fg-3)", fontWeight: 600, marginBottom: 6 }}>Event Progress</div><div style={{ display: "flex", alignItems: "center", gap: 12 }}><Ring value={68} label="68%" size={66} color="var(--success)" /><div><div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--fg-1)" }}>On track</div><div style={{ fontSize: 11, color: "var(--success-fg)", marginTop: 2 }}>↑ 6% vs last 7 days</div></div></div></Card>
          </div>

          {/* main row */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 300px 320px", gap: 16, marginBottom: 16 }}>
            {/* task board */}
            <Card pad={16}>
              <CardHead title="Task Board" right={<LinkBtn onClick={() => setTab("Tasks")}>Open full board</LinkBtn>} />
              {renderBoard(4)}
            </Card>
            {/* timeline */}
            <Card pad={16}>
              <CardHead title="Event Timeline" right={<LinkBtn onClick={() => setTab("Timeline")}>View</LinkBtn>} />
              {renderTimeline(timeline)}
            </Card>
            {/* verified sign-off */}
            <Card pad={16}>
              <CardHead title="Verified Sign-off" right={<LinkBtn onClick={() => setSignoffOpen(true)}>View all</LinkBtn>} />
              {renderSignoffCard()}
            </Card>
          </div>

          {/* bottom row */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16 }}>
            <Card pad={16}>
              <CardHead title="Run Sheet & Documents" right={<LinkBtn onClick={() => setTab("Documents")}>View all</LinkBtn>} />
              {docs.map((d, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => toast(`Opening file: ${d[0]}`, { tone: "info", icon: "file-text" })}
                  style={{ display: "flex", alignItems: "center", gap: 9, padding: "8px 0", borderTop: i ? "1px solid var(--border)" : 0, width: "100%", border: 0, borderRadius: 0, background: "transparent", cursor: "pointer", textAlign: "left", font: "inherit" }}
                >
                  <span style={{ width: 28, height: 28, borderRadius: 7, background: "var(--danger-bg)", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Icon name="file-text" size={14} color="var(--danger-fg)" /></span>
                  <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--fg-1)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{d[0]}</div><div style={{ fontSize: 10, color: "var(--fg-4)" }}>{d[1]}</div></div>
                </button>
              ))}
            </Card>
            <Card pad={16}><CardHead title="Team Allocation" right={<LinkBtn onClick={() => setTab("Team")}>View full team</LinkBtn>} />{team.map((t, i) => (<div key={i} style={{ display: "flex", alignItems: "center", gap: 9, padding: "8px 0", borderTop: i ? "1px solid var(--border)" : 0 }}><Avatar name={t[0]} size={28} /><div style={{ flex: 1 }}><div style={{ fontSize: 12, fontWeight: 600, color: "var(--fg-1)" }}>{t[0]}</div><div style={{ fontSize: 10, color: "var(--fg-4)" }}>{t[1]}</div></div><span className="fs-tnum" style={{ fontSize: 11.5, fontWeight: 700, color: "var(--fg-2)" }}>{t[2]}</span></div>))}<div style={{ fontSize: 11, color: "var(--fg-4)", marginTop: 8 }}>+1 team members</div></Card>
            <Card pad={16}><CardHead title="Live Service Activity" /> {activity.map((a, i) => { const [bg, fg] = STATUS[a[4]]; return (<div key={i} style={{ display: "flex", gap: 9, padding: "8px 0", borderTop: i ? "1px solid var(--border)" : 0 }}><span style={{ width: 26, height: 26, borderRadius: 7, background: bg, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Icon name={a[3]} size={13} color={fg} /></span><div style={{ flex: 1 }}><div style={{ fontSize: 11, color: "var(--fg-2)", lineHeight: 1.35 }}><b style={{ color: "var(--fg-1)" }}>{a[0]}</b> {a[1]}</div><div style={{ fontSize: 10, color: "var(--fg-4)" }}>{a[2]}</div></div></div>); })}</Card>
            <Card pad={16}><div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 12 }}><h4 style={{ margin: 0, fontSize: 14, flex: 1 }}>Compliance Summary</h4><img src="/assets/idara-icon-t.png" alt="idara" style={{ width: 14, height: 14 }} /></div><div style={{ display: "flex", alignItems: "center", gap: 12 }}><Ring value={96} label="96%" size={70} color="var(--success)" /><div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 7 }}>{([["Inductions", 100], ["Competencies", 94], ["Allergen Briefing", 98], ["PPE Compliance", 95]] as [string, number][]).map(([l, v]) => (<div key={l}><div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, marginBottom: 2 }}><span style={{ color: "var(--fg-3)" }}>{l}</span><span className="fs-tnum" style={{ fontWeight: 700, color: "var(--fg-1)" }}>{v}%</span></div><Bar value={v} color="var(--success)" height={3} /></div>))}</div></div></Card>
          </div>
        </>
      )}

      {/* ===================== TASKS (full board) ===================== */}
      {tab === "Tasks" && (
        <Card pad={18}>
          <CardHead
            title="Task Board"
            right={<Button size="sm" icon="plus" onClick={() => openAdd("To Do")}>Add task</Button>}
          />
          {renderBoard(4)}
        </Card>
      )}

      {/* ===================== TIMELINE ===================== */}
      {tab === "Timeline" && (
        <Card pad={18}>
          <CardHead title="Event Timeline" />
          <div style={{ maxWidth: 460 }}>{renderTimeline(timeline)}</div>
        </Card>
      )}

      {/* ===================== DOCUMENTS ===================== */}
      {tab === "Documents" && (
        <Card pad={18}>
          <CardHead title="Run Sheet & Documents" right={<Button size="sm" variant="sec" icon="upload" onClick={() => toast("Upload coming soon", { tone: "info", icon: "upload" })}>Upload</Button>} />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 10 }}>
            {docs.map((d, i) => (
              <button
                key={i}
                type="button"
                onClick={() => toast(`Opening file: ${d[0]}`, { tone: "info", icon: "file-text" })}
                className="hov-row"
                style={{ display: "flex", alignItems: "center", gap: 11, padding: 12, border: "1px solid var(--border)", borderRadius: 12, background: "#fff", cursor: "pointer", textAlign: "left", font: "inherit", width: "100%" }}
              >
                <span style={{ width: 34, height: 34, borderRadius: 9, background: "var(--danger-bg)", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Icon name="file-text" size={16} color="var(--danger-fg)" /></span>
                <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 13, fontWeight: 600, color: "var(--fg-1)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{d[0]}</div><div style={{ fontSize: 11, color: "var(--fg-4)" }}>{d[1]}</div></div>
                <Icon name="download" size={15} color="var(--fg-4)" />
              </button>
            ))}
          </div>
        </Card>
      )}

      {/* ===================== TEAM ===================== */}
      {tab === "Team" && (
        <Card pad={18}>
          <CardHead title="Team Allocation" right={<LinkBtn onClick={() => toast("Manage team coming soon", { tone: "info", icon: "users" })}>Manage</LinkBtn>} />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 10 }}>
            {team.map((t, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 11, padding: 12, border: "1px solid var(--border)", borderRadius: 12 }}>
                <Avatar name={t[0]} size={34} />
                <div style={{ flex: 1 }}><div style={{ fontSize: 13, fontWeight: 600, color: "var(--fg-1)" }}>{t[0]}</div><div style={{ fontSize: 11, color: "var(--fg-4)" }}>{t[1]}</div></div>
                <span className="fs-tnum" style={{ fontSize: 12.5, fontWeight: 700, color: "var(--fg-2)" }}>{t[2]}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ===================== ISSUES / REPORTS / SETTINGS ===================== */}
      {tab === "Issues" && (
        <Card pad={18}>
          <EmptyState
            icon="shield-alert"
            title="8 open issues"
            sub="2 high and 6 medium priority issues are being tracked for this event. The full issue tracker view is coming soon."
            action={<Button size="sm" icon="plus" onClick={() => toast("New issue form coming soon", { tone: "info", icon: "shield-alert" })}>Raise issue</Button>}
          />
        </Card>
      )}
      {tab === "Reports" && (
        <Card pad={18}>
          <EmptyState
            icon="chart-column"
            title="Event reports"
            sub="Generate service, labour and compliance reports for the Werribee Park Wedding. Report builder is coming soon."
            action={<Button size="sm" icon="download" onClick={() => toast("Generating report…", { tone: "info", icon: "download" })}>Generate report</Button>}
          />
        </Card>
      )}
      {tab === "Settings" && (
        <Card pad={18}>
          <EmptyState
            icon="settings"
            title="Event settings"
            sub="Configure visibility, members, integrations and sign-off rules for this event. Settings are coming soon."
            action={<Button size="sm" variant="sec" icon="settings" onClick={() => toast("Settings coming soon", { tone: "info", icon: "settings" })}>Configure</Button>}
          />
        </Card>
      )}

      {/* ===================== Add task modal ===================== */}
      <Modal
        open={addCol !== null}
        onClose={closeAdd}
        title={addCol ? `Add task to ${addCol}` : "Add task"}
        size="sm"
        footer={
          <>
            <Button variant="sec" size="sm" onClick={closeAdd}>Cancel</Button>
            <Button size="sm" icon="plus" onClick={submitAdd}>Add task</Button>
          </>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Field label="Task title">
            <TextField value={fTitle} onChange={setFTitle} placeholder="e.g. Confirm cake delivery window" />
          </Field>
          <Field label="Location / detail">
            <TextField value={fSub} onChange={setFSub} placeholder="e.g. Kitchen – plated service" />
          </Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Priority">
              <Select
                value={fPrio}
                onChange={setFPrio}
                options={[
                  { label: "High", value: "High" },
                  { label: "Medium", value: "Medium" },
                  { label: "Low", value: "Low" },
                ]}
              />
            </Field>
            <Field label="Due date">
              <TextField value={fDue} onChange={setFDue} placeholder="e.g. May 25" />
            </Field>
          </div>
          <Field label="Assignee">
            <Select value={fAssignee} onChange={setFAssignee} options={assigneeOptions} placeholder="Select a team member" />
          </Field>
        </div>
      </Modal>

      {/* ===================== Verified sign-off modal ===================== */}
      <Modal open={signoffOpen} onClose={() => setSignoffOpen(false)} title="Verified Sign-offs" size="md">
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {signoffs.map((s, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 11, padding: 12, border: "1px solid var(--border)", borderRadius: 12 }}>
              <span style={{ width: 34, height: 34, borderRadius: 9, background: "var(--success-bg)", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Icon name="badge-check" size={17} color="var(--success-fg)" /></span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--fg-1)" }}>{s[0]}</div>
                <div style={{ fontSize: 11.5, color: "var(--fg-4)" }}>{s[1]} · {s[2]} · {s[3]}</div>
              </div>
              <Badge tone="success">Verified</Badge>
            </div>
          ))}
          <div style={{ display: "flex", alignItems: "center", gap: 5, justifyContent: "center", marginTop: 4, fontSize: 11.5, color: "var(--fg-4)" }}>
            <img src="/assets/idara-icon-t.png" alt="idara" style={{ width: 13, height: 13, opacity: 0.6 }} />
            All sign-offs verified by idara
          </div>
        </div>
      </Modal>
    </div>
  );
}

/* ---- Shared sub-renderers (pure, no hooks) ---- */
function renderTimeline(timeline: [string, string, boolean | "active"][]) {
  return (
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
  );
}

function renderSignoffCard() {
  return (
    <div style={{ border: "1px solid var(--success-bg)", borderRadius: 12, overflow: "hidden" }}>
      <div style={{ background: "var(--success-bg)", padding: "8px 12px", display: "flex", alignItems: "center", gap: 7 }}><Icon name="check-circle-2" size={14} color="var(--success-fg)" /><span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--success-fg)", flex: 1 }}>Task Completed</span><Badge tone="success">Completed</Badge></div>
      <div style={{ padding: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--fg-1)" }}>Allergen sign-off — plated main</div>
        <div style={{ fontSize: 11, color: "var(--fg-4)", marginBottom: 10 }}>Kitchen — 38 flagged guests</div>
        <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--fg-4)", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 6 }}>Completed by</div>
        <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 10 }}><Avatar name="Darie Roberts" size={28} /><div style={{ flex: 1 }}><div style={{ fontSize: 12, fontWeight: 700, color: "var(--fg-1)" }}>Darie Roberts</div><div style={{ fontSize: 10, color: "var(--success-fg)", display: "flex", alignItems: "center", gap: 3 }}><img src="/assets/idara-icon-t.png" alt="idara" style={{ width: 10, height: 10 }} />ID: 9647 · Idara Verified</div></div><span style={{ fontSize: 10, color: "var(--fg-4)" }}>10:24 AM</span></div>
        <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--fg-4)", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 6 }}>Evidence</div>
        <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>{["#D9E2E8", "#C7D6DE", "#DDE6EB"].map((c, i) => <span key={i} style={{ width: 42, height: 32, borderRadius: 6, background: c, display: "inline-flex", alignItems: "center", justifyContent: "center" }}><Icon name="image" size={13} color="var(--fg-4)" /></span>)}<span style={{ width: 42, height: 32, borderRadius: 6, background: "var(--bg-2)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: "var(--fg-3)" }}>+3</span></div>
        {([["Head Chef Approval", "Hassan Ali", "May 16, 2024 · 10:45 AM"], ["Client Approval", "Michael Harris", "May 16, 2024 · 11:02 AM"]] as [string, string, string][]).map((a, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 0", borderTop: "1px solid var(--border)" }}><Avatar name={a[1]} size={22} /><div style={{ flex: 1 }}><div style={{ fontSize: 10, color: "var(--fg-4)" }}>{a[0]}</div><div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--fg-1)" }}>{a[1]}</div></div><Badge tone="success">Approved</Badge></div>
        ))}
        <div style={{ display: "flex", alignItems: "center", gap: 5, justifyContent: "center", marginTop: 10, fontSize: 10.5, color: "var(--fg-4)" }}><img src="/assets/idara-icon-t.png" alt="idara" style={{ width: 12, height: 12, opacity: 0.6 }} />Verified by idara</div>
      </div>
    </div>
  );
}
