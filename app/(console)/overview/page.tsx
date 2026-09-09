"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Card, Ring, Bar, Spark, Avatar, AvatarStack, Icon, Tabs, STATUS } from "@/components/ui";
import { useToast } from "@/components/ui";
import type { Tone } from "@/lib/status";
import { PageHead, CardHead, LinkBtn } from "@/components/screen/page-head";
import { NotComputed } from "@/components/screen/not-computed";
import { useIdara } from "@/lib/idara/provider";
import { boardFrom } from "@/lib/shifts";
import { assessAll, type ShiftSession } from "@/lib/awards";

interface Metric {
  label: string;
  value: string;
  status: string;
  statusTone: string;
  link: string;
  href: string;
  icon: string;
  accent: string | null;
  /** true when no code derives this number from anything. */
  illustrative?: boolean;
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
     Half of this page is folded from the chain and the clock.
     The other half never was: fairness, the heatmap, run sheet
     tasks and function rooms are figures no code derives, and
     they sat beside the real ones looking identical.

     Wired where a source exists; labelled where none does. Not
     filled in with something weaker, which is the failure this
     console keeps finding — a number that looks like a
     measurement and is the absence of one.
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
    () => board.postings.filter((x) => x.status === "open").slice(0, 3),
    [board],
  );

  /* The last few things that actually happened, off the chain. Every row is
     an event somebody can find in the audit log. */
  const recent = useMemo(() => auditLog.slice(-4).reverse(), [auditLog]);

  const metrics: Metric[] = [
    { label: "Open Function Rooms", value: "7", status: "Active", statusTone: "var(--fg-3)", link: "View all events", href: "/events", icon: "briefcase", accent: null, illustrative: true },
    { label: "Credential Alerts", value: String(credAlerts), status: credAlerts === 1 ? "Requires attention" : "Require attention", statusTone: "var(--fg-3)", link: "View alerts", href: "/credentials", icon: "shield-alert", accent: "var(--danger)" },
    { label: "Run Sheet Tasks", value: "64", status: "In progress", statusTone: "var(--fg-3)", link: "View run sheets", href: "/projects", icon: "list-checks", accent: null, illustrative: true },
  ];
  const heat: [string, number[]][] = [
    ["Brightwater Hotel", [2, 3, 4, 6, 6, 5, 3]],
    ["Gaming Room", [1, 2, 3, 4, 6, 6, 4]],
    ["Northside Tavern", [1, 2, 4, 5, 6, 5, 3]],
    ["Quayside", [0, 1, 2, 3, 5, 4, 2]],
    ["Off-premise", [0, 1, 1, 2, 4, 5, 2]],
  ];
  const viz = ["#ECF6F4", "#CDEAE4", "#A3DAD0", "#6CC6B8", "#2FA897", "#0D8B82", "#075A54"];
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
          {/* Nothing computes a roster-wide fairness score. lib/matching has a
              per-candidate fairness COMPONENT used to rank people for a shift;
              there is no venue-level figure behind this and no trend behind
              the panel below. */}
          <div style={{ fontSize: 13, color: "var(--fg-3)", fontWeight: 600 }}>Roster Fairness Score</div>
          <div style={{ margin: "4px 0 8px" }}>
            <NotComputed title="No roster-wide fairness score is computed anywhere" />
          </div>
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
            {m.illustrative && <span style={{ marginTop: 3 }}><NotComputed /></span>}
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
            title={<span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>Fairness Trend <NotComputed /></span>}
            right={<Tabs tabs={["7d", "4w", "12w"]} value={period} onChange={setPeriod} />}
          />
          <div style={{ position: "relative", height: 130 }}>
            <Spark data={trend.data} width={300} height={120} />
            <span style={{ position: "absolute", top: 0, right: 0, background: "var(--fs-teal)", color: "#fff", fontSize: 12, fontWeight: 700, padding: "3px 8px", borderRadius: 6 }}>{trend.value}</span>
            <span style={{ position: "absolute", bottom: 0, left: 0, fontSize: 11.5, color: "var(--fg-4)" }}>{TREND_LABEL[period]}</span>
          </div>
        </Card>
        <Card>
          {/* The floor view and the break board read the real clock; this grid
              is a fixed pattern. Kept because the shape is the intent, marked
              because it is not a reading. */}
          <CardHead
            title={<span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>Attendance Heatmap (Today) <NotComputed /></span>}
            right={<LinkBtn href="/attendance">View attendance</LinkBtn>}
          />
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
      {/* bottom row */}
      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1.2fr 1.1fr", gap: 16 }}>
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
          <CardHead
            title={<span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>Venues &amp; Events <NotComputed /></span>}
            right={<LinkBtn href="/projects">View all</LinkBtn>}
          />
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
          <CardHead
            title={<span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>Top Fairness Contributors <NotComputed /></span>}
            right={<LinkBtn href="/reports">View report</LinkBtn>}
          />
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
