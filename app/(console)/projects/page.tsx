"use client";

import { useEffect, useState } from "react";
import { NotComputedNote } from "@/components/screen/not-computed";
import {
  Card,
  AvatarStack,
  Badge,
  Icon,
  Button,
  Menu,
  Modal,
  Field,
  TextField,
  Select,
  STATUS,
  useToast,
} from "@/components/ui";
import type { Tone } from "@/lib/status";
import { CardHead } from "@/components/screen/page-head";

/* The card shape, the columns and the seed all live in lib/tasks now, because
   the API route folds the same types out of the audit chain. Two definitions
   of what a task is would be two things that can disagree about a board. */
import { COLS, cardInColumn, seedBoard, type ColName, type TaskBoard } from "@/lib/tasks";

/**
 * Who a task can be assigned to.
 *
 * Names, not DIDs. A run sheet task is not gated on anything, so this is a
 * label on a card rather than a claim about who is permitted to do the work.
 * The shift is where that question gets asked, and Idara answers it there.
 */
const ASSIGNEES = ["Priya Sharma", "Hassan Ali", "Darie Roberts", "Sophie Nguyen", "Ben Cole", "Ana Reed", "Cara Vu", "Eve Ho", "Gus Ray"];

/**
 * What on this screen is folded, and what is staging.
 *
 * This replaces a page-level ILLUSTRATIVE banner that read "Covers records no
 * run sheets… nothing holds the tasks". True when #42 wrote it, false from #45,
 * when the board started folding task.moved and task.created off the chain —
 * and a banner cannot notice that about itself. It sat there through a whole
 * feature landing underneath it, telling readers not to trust the one panel on
 * the screen that had become trustworthy.
 *
 * Which is the argument for saying less: a shorter claim has fewer ways to go
 * quietly out of date.
 */
function BoardNote() {
  return (
    <NotComputedNote>
      The board below is folded from the audit chain — every move and every new task is an
      event you can find in the log, and it survives a reload. The event it hangs under is a
      seed row: Covers records no engagements yet.
    </NotComputedNote>
  );
}

export default function ProjectsPage() {
  const toast = useToast();

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

  /* What the column actually holds.

     These headers used to add a BASE_EXTRA padding per column, so "To Do"
     read 12 above three cards. It made the board look like a real week and
     made the header disagree with everything under it — including the
     overview tile, which now folds this same board. A count nobody can
     check against the thing it counts is not a count. */
  const count = (c: ColName) => board[c].length;

  const colTone: Record<ColName, Tone> = { "To Do": "neutral", "In Progress": "info", Review: "warning", Completed: "success" };
  const prio: Record<"High" | "Medium" | "Low", Tone> = { High: "danger", Medium: "warning", Low: "neutral" };

  const assigneeOptions = ASSIGNEES.map((n) => ({ label: n, value: n }));

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

  /* ---- Reusable board renderer (compact in Dashboard, full-width in Tasks) ---- */
  const renderBoard = (cardCols = 4) => (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${cardCols},1fr)`, gap: 14 }}>
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
      <BoardNote />
      <div style={{ display: "flex", alignItems: "flex-start", gap: 16, marginBottom: 18 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <h2 style={{ margin: 0, fontSize: 24 }}>Werribee Park Wedding — Run Sheet</h2>
            <Badge tone="success" dot>Active</Badge>
            <Icon name="star" size={17} color="var(--warning)" />
          </div>
          <p style={{ margin: "4px 0 0", fontSize: 14 }}>180 guests · Saturday service · Nguyen &amp; Cole</p>

        </div>
      </div>

      {/* ===================== TASKS (full board) ===================== */}
      <Card pad={18}>
        <CardHead
          title="Task Board"
          right={<Button size="sm" icon="plus" onClick={() => openAdd("To Do")}>Add task</Button>}
        />
        {renderBoard(4)}
      </Card>

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

    </div>
  );
}

