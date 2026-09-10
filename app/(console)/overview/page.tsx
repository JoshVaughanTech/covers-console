"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Card, Ring, AvatarStack, Icon, STATUS } from "@/components/ui";
import { useToast } from "@/components/ui";
import type { Tone } from "@/lib/status";
import { PageHead, CardHead, LinkBtn } from "@/components/screen/page-head";
import { useIdara } from "@/lib/idara/provider";
import { boardFrom } from "@/lib/shifts";
import { replayTasks, COLS } from "@/lib/tasks";
import { assessAll, type ShiftSession } from "@/lib/awards";

interface Metric {
  label: string;
  value: string;
  status: string;
  link: string;
  href: string;
  icon: string;
  accent: string | null;
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

  /* ==========================================================
     Five panels, all of which move.

     This screen carried eleven. Six of them — the roster fairness
     score, its trend, the attendance heatmap, the venue bars, the
     top contributors and the open function rooms — were figures no
     code derived from anything. #42 labelled them ILLUSTRATIVE,
     which stopped them lying, and left the more ordinary problem
     standing: a manager opening the console read eleven cards to
     find the four that were asking for something.

     Labelling says "do not trust this". Removing says "there is
     nothing here to trust yet" — the same fact, taking up none of
     the screen. Nothing goes that a reader could have acted on,
     because none of it moved when the venue's week did. That was
     the definition of the marking.

     Note what survives the word "fairness": lib/matching/matcher.ts
     still computes a per-candidate fairness component, and it still
     decides who gets offered a shift. What went is the venue-level
     SCORE, which nothing computed. One word, two things, and only
     one of them was ever a measurement.

     Every panel below folds from the chain or reads the clock.
     ========================================================== */
  const { auditLog, credentials, today } = useIdara();

  /* Live attendance, from the same /api/breaks the floor view and the break
     board read. Three readings of one clock would be three chances to
     disagree about who is at work. */
  const [sessions, setSessions] = useState<ShiftSession[]>([]);
  const [asOf, setAsOf] = useState<number | null>(null);
  const loadClock = useCallback(async () => {
    try {
      const r = await fetch("/api/breaks", { cache: "no-store" });
      if (!r.ok) return;
      const b = (await r.json()) as { sessions: ShiftSession[]; asOf?: number };
      setSessions(b.sessions ?? []);
      if (typeof b.asOf === "number") setAsOf(b.asOf);
    } catch { /* the tile shows what it has; the floor view reports the error */ }
  }, []);
  useEffect(() => {
    void loadClock();
    const t = setInterval(() => void loadClock(), 30_000);
    return () => clearInterval(t);
  }, [loadClock]);

  const floor = useMemo(() => {
    const now = asOf ?? Math.floor(Date.now() / 1000);
    const staff = assessAll(sessions, now, {});
    const on = staff.filter((a) => a.onShift);
    return {
      onShift: on.length,
      onBreak: on.filter((a) => a.onBreak).length,
      overdue: on.filter((a) => a.severity === 3).length,
    };
  }, [sessions, asOf]);

  /* Credentials needing attention: expired, revoked or suspended, plus the
     ones lapsing inside a month. Counted off the credential records rather
     than a stored total, so it moves when one is revoked. */
  const credAlerts = useMemo(() => {
    const soon = new Date(today);
    soon.setDate(soon.getDate() + 30);
    const horizon = soon.toISOString().slice(0, 10);
    return credentials.filter((c) => {
      if (c.status !== "valid") return true;
      return c.expiresAt != null && c.expiresAt <= horizon;
    }).length;
  }, [credentials, today]);

  /* The board, folded from the chain — the same boardFrom() the marketplace
     and the phone read. */
  const board = useMemo(() => boardFrom(auditLog), [auditLog]);
  const upcomingShifts = useMemo(
    () => board.postings.filter((x) => x.status === "open").slice(0, 5),
    [board],
  );

  /* Run sheet tasks still open, folded from the chain the run sheet itself
     folds. This tile read a literal 64 while the board underneath it had
     become real — the number nobody updated because nothing made them.
     Drag a card into Completed and this drops, because the tile and the
     board are now replayTasks() over the same log. */
  const openTasks = useMemo(() => {
    const b = replayTasks(auditLog);
    return COLS.filter((c) => c !== "Completed").reduce((n, c) => n + b[c].length, 0);
  }, [auditLog]);

  /* The last few things that actually happened, off the chain. Every row is
     an event somebody can find in the audit log. */
  const recent = useMemo(() => auditLog.slice(-6).reverse(), [auditLog]);

  const metrics: Metric[] = [
    { label: "Credential Alerts", value: String(credAlerts), status: credAlerts === 1 ? "Requires attention" : "Require attention", link: "View alerts", href: "/credentials", icon: "shield-alert", accent: "var(--danger)" },
    { label: "Run Sheet Tasks", value: String(openTasks), status: "Still open", link: "View run sheets", href: "/projects", icon: "list-checks", accent: null },
  ];

  return (
    <div>
      <PageHead title="Good morning, Emma! 👋" sub="Here's what's happening across your operations." />
      {/* top metric row */}
      <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr 1fr", gap: 16, marginBottom: 16 }}>
        <ClickableCard pad={18} ariaLabel="View live attendance" onClick={() => router.push("/attendance")} style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 13, color: "var(--fg-3)", fontWeight: 600, marginBottom: 8 }}>Live Attendance</div>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            {/* No "/168 rostered" denominator and no Late or Absent: a punch
                carries no rostered START, so lateness is not computable, and
                absence needs a roster of who was expected — nobody who never
                arrived appears in a list of punches at all. The ring shows how
                much of the floor is working rather than on a break. */}
            <Ring
              value={floor.onShift === 0 ? 0 : Math.round(((floor.onShift - floor.onBreak) / floor.onShift) * 100)}
              label={String(floor.onShift)}
              sub="on shift"
              size={84}
              color="var(--success)"
            />
            <div style={{ fontSize: 12.5, display: "flex", flexDirection: "column", gap: 5 }}>
              <span style={{ display: "flex", justifyContent: "space-between", gap: 14 }}><span style={{ color: "var(--fg-2)" }}><span style={{ color: "var(--success)" }}>●</span> On the floor</span><b className="fs-tnum">{floor.onShift - floor.onBreak}</b></span>
              <span style={{ display: "flex", justifyContent: "space-between", gap: 14 }}><span style={{ color: "var(--fg-2)" }}><span style={{ color: "var(--info)" }}>●</span> On a break</span><b className="fs-tnum">{floor.onBreak}</b></span>
              <span style={{ display: "flex", justifyContent: "space-between", gap: 14 }}><span style={{ color: "var(--fg-2)" }}><span style={{ color: "var(--danger)" }}>●</span> Meal overdue</span><b className="fs-tnum">{floor.overdue}</b></span>
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
            <span style={{ fontSize: 12.5, color: "var(--fg-3)" }}>{m.status}</span>
            <div style={{ marginTop: 6 }}><LinkBtn href={m.href}>{m.link}</LinkBtn></div>
          </ClickableCard>
        ))}
      </div>
      {/* bottom row */}
      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 16 }}>
        <Card>
          {/* The last few events on the chain. Every row here is something a
              reader can go and find in the audit log, which is the difference
              between an activity feed and a list of plausible sentences. */}
          <CardHead title="Recent Activity" right={<LinkBtn href="/audit">View the log</LinkBtn>} />
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {recent.length === 0 && (
              <span style={{ fontSize: 12.5, color: "var(--fg-4)", padding: "8px 0" }}>Nothing on the chain yet.</span>
            )}
            {recent.map((e) => {
              const tone: Tone = e.type.startsWith("credential.") ? "danger"
                : e.type.startsWith("shift.") ? "success"
                : e.type.startsWith("break.") ? "warning" : "info";
              const icon = e.type.startsWith("credential.") ? "shield-alert"
                : e.type.startsWith("shift.") ? "calendar-check"
                : e.type.startsWith("break.") ? "coffee" : "file-text";
              const a = { tone, icon, text: e.summary, meta: e.actor, t: `#${e.seq}`, href: "/audit", toast: "Opening the audit log" };
              const [bg, fg] = STATUS[a.tone];
              return (
                <button
                  key={e.seq}
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
          {/* The board, folded from the chain — the same postings the
              marketplace publishes and the phone claims against. */}
          <CardHead title="Open shifts" right={<LinkBtn href="/open-shifts">View the board</LinkBtn>} />
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {upcomingShifts.map((sh) => (
              <div key={sh.id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--fg-1)" }}>{sh.day} · {sh.window}</div>
                  <div style={{ fontSize: 12, color: "var(--fg-3)" }}>{sh.role} · {sh.functionName}</div>
                </div>
                {sh.claims.length > 0 ? (
                  <AvatarStack names={sh.claims.slice(0, 3).map((c) => c.did.split(":").pop() ?? "")} size={26} extra={Math.max(0, sh.claims.length - 3)} />
                ) : (
                  <span style={{ fontSize: 11.5, color: "var(--fg-4)", whiteSpace: "nowrap" }}>no claims yet</span>
                )}
              </div>
            ))}
            {upcomingShifts.length === 0 && (
              <span style={{ fontSize: 12.5, color: "var(--fg-4)" }}>Nothing open on the board.</span>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
