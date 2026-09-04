"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { SignIn, type Signed } from "../sign-in";
import { MobileNav } from "../nav";

/* ============================================================
   My shifts — what this person has on, and what they worked.

   The board answers "what work is going?". This answers "what have
   I got on?", and separating them is why the board no longer
   carries "You're on" and "Waiting on the manager": one fact, one
   screen, so two screens cannot show different counts for the same
   shift.

   Done is read from the time clock rather than the board, and the
   distinction is load-bearing. Being rostered on a shift that has
   passed is not evidence anybody worked it — a clock-in is. So a
   shift somebody was rostered for and did not attend never appears
   here as work they did, and the tab is honest about which of the
   two it is showing.

   It is also the first screen that tells a worker what the break
   rules earned them. If the venue owes cl 16.6 loading, the person
   owed it sees the venue's own figure, computed by the same assess()
   the Break Board runs.

   Withdraw is here and not on the board because this is where a
   commitment lives. It is deliberately easy: a claim you cannot
   take back is a claim you think twice about making, and a board
   where people hesitate to put their hand up is the failure this
   marketplace exists to avoid.
   ============================================================ */

type State = "confirmed" | "applied" | "declined";

interface Pay {
  offeredHourlyCents: number;
  floorHourlyCents: number;
  estGrossCents: number;
  paidHours: number;
  atOrAboveFloor: boolean;
  mixedRates: boolean;
}

interface Shift {
  id: string;
  role: string;
  functionName: string;
  client: string | null;
  siteName: string;
  region: string | null;
  day: string;
  window: string;
  pay: Pay | null;
  startsAt: number | null;
  endsAt: number | null;
  state: State;
  claimedAt: string | null;
  declinedReason: string | null;
  applicants: number | null;
  seats: number;
  seatsLeft: number;
}

interface Done {
  sessionId: string;
  role: string;
  siteName: string;
  clockIn: number;
  clockOut: number;
  hours: number;
  breaksTaken: number;
  owed: { clause: string; minutes: number; amount: string | null } | null;
}

interface Payload {
  worker: { did: string; name: string; role: string };
  now: number;
  shifts: Shift[];
  done: Done[];
  doneWeek: { start: number; end: number };
  counts: { confirmed: number; applied: number; declined: number; done: number };
  nextStartsAt: number | null;
  hours: { thisWeek: number; fullWeek: number } | null;
}

const aud = (cents: number) => {
  const sign = cents < 0 ? "-" : "";
  const a = Math.abs(cents);
  return `${sign}$${Math.floor(a / 100)}.${String(a % 100).padStart(2, "0")}`;
};

const TZ = "Australia/Melbourne";
const clock = (ts: number) =>
  new Date(ts * 1000).toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TZ });
const dayLabel = (ts: number) =>
  new Date(ts * 1000).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", timeZone: TZ });

/**
 * When a shift is, in one place.
 *
 * The card and the withdraw sheet were reading different fields for this and
 * disagreed on screen — "Sat, 5 Sept" on the card above "Sat, 18 May" in the
 * sheet, for one shift. `day` is display text a manager typed; `startsAt` is
 * the moment the award was applied to. Where both exist the real one wins, and
 * nothing reads the other directly.
 */
const whenOf = (s: { startsAt: number | null; day: string }) =>
  s.startsAt != null ? dayLabel(s.startsAt) : s.day;

/** "in 7h", "in 40m", "now". Coarse on purpose — nobody counts seconds to a shift. */
function until(from: number, to: number): string {
  const s = to - from;
  if (s <= 0) return "now";
  if (s < 3600) return `in ${Math.round(s / 60)}m`;
  if (s < 86400) return `in ${Math.round(s / 3600)}h`;
  return `in ${Math.round(s / 86400)}d`;
}

type Tab = "upcoming" | "applied" | "done";

export default function MyShiftsPage() {
  const [me, setMe] = useState<Signed | null>(null);
  const [ready, setReady] = useState(false);
  const [payload, setPayload] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("upcoming");
  const [busy, setBusy] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const r = await fetch("/api/auth/session");
        const b = await r.json();
        if (b.signedIn) setMe(b.worker as Signed);
      } catch {
        /* offline: the sign-in screen is the honest thing to show */
      } finally {
        setReady(true);
      }
    })();
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/my-shifts");
      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
      setPayload(await res.json());
      setError(null);
    } catch (e) {
      // an empty list must not be the failure mode: "you have nothing on" is a
      // different and much worse thing to tell someone than "this didn't load"
      setError(e instanceof Error ? e.message : "Could not load your shifts");
    }
  }, []);

  useEffect(() => {
    if (me) void load();
  }, [me, load]);

  const groups = useMemo(() => {
    const all = payload?.shifts ?? [];
    return {
      upcoming: all.filter((s) => s.state === "confirmed"),
      applied: all.filter((s) => s.state === "applied"),
      declined: all.filter((s) => s.state === "declined"),
    };
  }, [payload]);

  async function withdraw(s: Shift) {
    setConfirming(null);
    setBusy((b) => ({ ...b, [s.id]: "sending" }));
    try {
      const res = await fetch("/api/shifts/withdraw", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ postingId: s.id, clientRef: `${s.id}:${Date.now()}` }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      // not a rest-destructure with a discarded binding: noUnusedLocals counts
      // that binding as unused, and it is the only reason it would exist
      setBusy((b) => Object.fromEntries(Object.entries(b).filter(([k]) => k !== s.id)));
      await load();
    } catch (e) {
      setBusy((b) => ({ ...b, [s.id]: e instanceof Error ? e.message : "failed" }));
    }
  }

  if (!ready) return null;
  if (!me) return <SignIn onSignedIn={setMe} />;

  const c = payload?.counts;
  const active = confirming ? groups.applied.find((s) => s.id === confirming) ?? null : null;

  return (
    <div style={{ padding: "14px 14px 28px" }}>
      <header style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 14 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ margin: 0, fontSize: 21, letterSpacing: "-.02em" }}>My shifts</h1>
          <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--fg-4)" }}>
            {c
              ? `${c.confirmed} confirmed · ${c.applied} pending${
                  payload?.nextStartsAt ? ` · next one ${until(payload.now, payload.nextStartsAt)}` : ""
                }`
              : "…"}
          </p>
        </div>
        <button
          onClick={() => {
            void fetch("/api/auth/session", { method: "DELETE" }).finally(() => {
              setMe(null);
              setPayload(null);
            });
          }}
          style={{
            border: "1px solid var(--border-2)", background: "#fff", borderRadius: 999,
            padding: "6px 12px", fontSize: 12, fontWeight: 600, color: "var(--fg-2)", cursor: "pointer",
          }}
        >
          {me.name.split(" ")[0]}
        </button>
      </header>

      <MobileNav current="/m/mine" />

      <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
        {(
          [
            ["upcoming", "Upcoming", groups.upcoming.length],
            ["applied", "Applied", groups.applied.length],
            ["done", "Done", payload?.done.length ?? 0],
          ] as const
        ).map(([id, label, n]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            style={{
              flex: 1, minHeight: 38, borderRadius: 10, cursor: "pointer",
              fontSize: 13, fontWeight: 600, font: "inherit",
              border: `1px solid ${tab === id ? "var(--fg-1)" : "var(--border)"}`,
              background: tab === id ? "var(--fg-1)" : "#fff",
              color: tab === id ? "#fff" : "var(--fg-3)",
            }}
          >
            {label}
            {n > 0 && <span style={{ opacity: 0.7 }}> {n}</span>}
          </button>
        ))}
      </div>

      {error && <Banner tone="danger">{error}</Banner>}
      {!payload && !error && <p style={{ fontSize: 13, color: "var(--fg-4)" }}>Loading your shifts…</p>}

      {payload && tab === "upcoming" && (
        <>
          {groups.upcoming.length === 0 && (
            <Banner tone="info">
              Nothing confirmed yet. Anything you&rsquo;ve applied for is under Applied.
            </Banner>
          )}
          {groups.upcoming.map((s) => (
            <ShiftCard key={s.id} s={s} now={payload.now} />
          ))}
          {payload.hours && <HoursCard hours={payload.hours} />}
        </>
      )}

      {payload && tab === "applied" && (
        <>
          {groups.applied.length === 0 && groups.declined.length === 0 && (
            <Banner tone="info">Nothing waiting on a manager right now.</Banner>
          )}
          {groups.applied.map((s) => (
            <ShiftCard
              key={s.id}
              s={s}
              now={payload.now}
              busy={busy[s.id]}
              onWithdraw={() => setConfirming(s.id)}
            />
          ))}
          {groups.declined.length > 0 && (
            <>
              <h2 style={sectionTitle}>Not this time ({groups.declined.length})</h2>
              {groups.declined.map((s) => (
                <ShiftCard key={s.id} s={s} now={payload.now} />
              ))}
            </>
          )}
        </>
      )}

      {payload && tab === "done" && <DoneList payload={payload} />}

      {active && (
        <ConfirmWithdraw
          s={active}
          onCancel={() => setConfirming(null)}
          onConfirm={() => void withdraw(active)}
        />
      )}
    </div>
  );
}

/* ---------- pieces ---------- */

const sectionTitle: React.CSSProperties = {
  margin: "18px 0 8px", fontSize: 11.5, fontWeight: 700, letterSpacing: ".06em",
  textTransform: "uppercase", color: "var(--fg-4)",
};

function ShiftCard({
  s, now, busy, onWithdraw,
}: {
  s: Shift; now: number; busy?: string; onWithdraw?: () => void;
}) {
  const soon = s.startsAt != null && s.startsAt - now < 12 * 3600 && s.startsAt > now;
  const tone = s.state === "confirmed" ? "success" : s.state === "applied" ? "warning" : "neutral";

  return (
    <div
      style={{
        border: `1px solid ${soon ? "var(--accent, var(--fs-teal))" : "var(--border-2)"}`,
        borderRadius: 12, padding: "12px 13px", marginBottom: 10, background: "#fff",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
        <span
          style={{
            fontSize: 11.5, fontWeight: 700, borderRadius: 999, padding: "3px 9px",
            background: tone === "neutral" ? "var(--bg-2)" : `var(--${tone}-bg)`,
            color: tone === "neutral" ? "var(--fg-3)" : `var(--${tone}-fg)`,
          }}
        >
          {s.state === "confirmed" ? "Confirmed" : s.state === "applied" ? "Applied · waiting on venue" : "Not needed"}
          {soon && s.state === "confirmed" && " · today"}
        </span>
        <span style={{ fontSize: 11.5, color: "var(--fg-4)", whiteSpace: "nowrap", textAlign: "right" }}>
          {whenOf(s)}
        </span>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginTop: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 15.5, fontWeight: 700, color: "var(--fg-1)" }}>
            {s.role} · {s.functionName}
          </div>
          <div style={{ fontSize: 12.5, color: "var(--fg-3)", marginTop: 2 }}>
            {s.siteName} · {s.window}
            {s.pay && ` · ${s.pay.paidHours}h`}
          </div>
        </div>
        {s.pay && (
          <div style={{ textAlign: "right", flexShrink: 0 }}>
            <div className="fs-tnum" style={{ fontSize: 17, fontWeight: 800, color: "var(--fg-1)" }}>
              {aud(s.pay.estGrossCents)}
            </div>
            <div style={{ fontSize: 11, color: "var(--fg-4)" }}>est.</div>
          </div>
        )}
      </div>

      {/* Clock-in is derived from the real start time, so a posting with no
          rate — and therefore no timestamps — simply does not show one. */}
      {s.state === "confirmed" && s.startsAt != null && (
        <div style={{ fontSize: 12, color: "var(--fg-3)", marginTop: 7 }}>
          Clock in from <strong style={{ color: "var(--fg-1)" }}>{clock(s.startsAt - 15 * 60)}</strong>
          {soon && ` · starts ${until(now, s.startsAt)}`}
        </div>
      )}

      {s.pay && !s.pay.atOrAboveFloor && (
        <div
          style={{
            marginTop: 7, fontSize: 12, fontWeight: 600, borderRadius: 8, padding: "6px 9px",
            background: "var(--danger-bg)", color: "var(--danger-fg)",
          }}
        >
          This shift is below the award floor of {aud(s.pay.floorHourlyCents)}/h. Tell the venue.
        </div>
      )}

      {s.state === "applied" && (
        <div style={{ fontSize: 12, color: "var(--fg-4)", marginTop: 7 }}>
          {s.applicants === 1
            ? "You're the only applicant so far"
            : `You're 1 of ${s.applicants} applicants`}
          {s.seatsLeft > 1 && ` · ${s.seatsLeft} seats open`}
        </div>
      )}

      {s.declinedReason && (
        <div style={{ fontSize: 12, color: "var(--fg-3)", marginTop: 7 }}>{s.declinedReason}</div>
      )}

      {busy && busy !== "sending" && (
        <div style={{ fontSize: 12, color: "var(--danger-fg)", marginTop: 7 }}>{busy}</div>
      )}

      {onWithdraw && (
        <button
          onClick={onWithdraw}
          disabled={busy === "sending"}
          style={{
            marginTop: 10, minHeight: 40, width: "100%", borderRadius: 10, font: "inherit",
            fontSize: 13.5, fontWeight: 600, cursor: busy === "sending" ? "default" : "pointer",
            border: "1px solid var(--border-2)", background: "#fff", color: "var(--danger-fg)",
            opacity: busy === "sending" ? 0.6 : 1,
          }}
        >
          {busy === "sending" ? "Withdrawing…" : "Withdraw"}
        </button>
      )}
    </div>
  );
}

function DoneList({ payload }: { payload: Payload }) {
  const week = `${dayLabel(payload.doneWeek.start)} – ${dayLabel(payload.doneWeek.end - 86400)}`;
  const owedTotal = payload.done.filter((d) => d.owed).length;

  return (
    <>
      <p style={{ margin: "0 0 12px", fontSize: 12, color: "var(--fg-4)", lineHeight: 1.5 }}>
        From the time clock, {week}. These are shifts you clocked on for — not shifts you were
        rostered for.
      </p>

      {payload.done.length === 0 && (
        <Banner tone="info">No clocked shifts in that week.</Banner>
      )}

      {owedTotal > 0 && (
        <Banner tone="warn">
          <strong>
            {owedTotal} of these {owedTotal === 1 ? "shift has" : "shifts have"} break loading owed.
          </strong>
          <span style={{ display: "block", marginTop: 3 }}>
            Under the Hospitality Award your venue owes extra when a meal break is missed. The figure
            below is the venue&rsquo;s own — the same one their Break Board shows.
          </span>
        </Banner>
      )}

      {payload.done.map((d) => (
        <div
          key={d.sessionId}
          style={{
            border: "1px solid var(--border-2)", borderRadius: 12, padding: "12px 13px",
            marginBottom: 10, background: "#fff",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: "var(--fg-1)" }}>{d.role}</div>
              <div style={{ fontSize: 12.5, color: "var(--fg-3)", marginTop: 2 }}>
                {d.siteName} · {clock(d.clockIn)}–{clock(d.clockOut)}
              </div>
            </div>
            <div style={{ textAlign: "right", flexShrink: 0 }}>
              <div className="fs-tnum" style={{ fontSize: 16, fontWeight: 800, color: "var(--fg-1)" }}>
                {d.hours}h
              </div>
              <div style={{ fontSize: 11, color: "var(--fg-4)" }}>{dayLabel(d.clockIn)}</div>
            </div>
          </div>

          <div style={{ fontSize: 12, color: "var(--fg-4)", marginTop: 6 }}>
            {d.breaksTaken === 0 ? "No breaks recorded" : `${d.breaksTaken} break${d.breaksTaken === 1 ? "" : "s"} recorded`}
          </div>

          {d.owed && (
            <div
              style={{
                marginTop: 8, borderRadius: 9, padding: "8px 10px", fontSize: 12.5, lineHeight: 1.5,
                background: "var(--warning-bg)", color: "var(--warning-fg)", fontWeight: 600,
              }}
            >
              Break loading owed — cl {d.owed.clause}, {d.owed.minutes} min
              {d.owed.amount && ` · ${d.owed.amount}`}
            </div>
          )}
        </div>
      ))}
    </>
  );
}

function HoursCard({ hours }: { hours: { thisWeek: number; fullWeek: number } }) {
  const full = hours.thisWeek >= hours.fullWeek;
  return (
    <>
      <h2 style={sectionTitle}>This week</h2>
      <div style={{ border: "1px solid var(--border-2)", borderRadius: 12, padding: "13px 14px", background: "#fff" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <span className="fs-tnum" style={{ fontSize: 20, fontWeight: 800, color: "var(--fg-1)" }}>
            {hours.thisWeek}h
            <span style={{ fontSize: 13, fontWeight: 500, color: "var(--fg-4)" }}> of {hours.fullWeek}</span>
          </span>
          <span style={{ fontSize: 12, color: "var(--fg-4)" }}>
            {full ? "At a full week" : `Room for ${hours.fullWeek - hours.thisWeek}h more`}
          </span>
        </div>
        <div style={{ marginTop: 9, height: 7, borderRadius: 999, background: "var(--bg-2)", overflow: "hidden" }}>
          <div
            style={{
              width: `${Math.min(100, (hours.thisWeek / hours.fullWeek) * 100)}%`,
              height: "100%",
              background: full ? "var(--warning)" : "var(--fs-teal, #0d8b82)",
            }}
          />
        </div>
      </div>
    </>
  );
}

/* Withdrawing is easy, and confirmed anyway: it is one tap from a list, and
   the tap next to it opens a shift. A mis-tap that quietly leaves a queue is
   discovered a week later when the shift never came. */
function ConfirmWithdraw({
  s, onCancel, onConfirm,
}: { s: Shift; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div
      onClick={onCancel}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.34)", display: "flex", alignItems: "flex-end", zIndex: 40 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%", background: "var(--bg)", borderRadius: "16px 16px 0 0",
          padding: "18px 16px calc(18px + env(safe-area-inset-bottom))",
        }}
      >
        <h2 style={{ margin: "0 0 6px", fontSize: 18, letterSpacing: "-.02em" }}>Withdraw this claim?</h2>
        <p style={{ margin: "0 0 16px", fontSize: 13.5, lineHeight: 1.55, color: "var(--fg-3)" }}>
          {s.role} · {s.functionName}, {whenOf(s)}. You&rsquo;ll come out of the manager&rsquo;s queue.
          You can put your hand up again while the shift is still open.
        </p>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={onCancel}
            style={{
              flex: 1, minHeight: 50, borderRadius: 12, font: "inherit", fontSize: 15, fontWeight: 600,
              border: "1px solid var(--border-2)", background: "#fff", color: "var(--fg-2)", cursor: "pointer",
            }}
          >
            Keep it
          </button>
          <button
            onClick={onConfirm}
            style={{
              flex: 1, minHeight: 50, borderRadius: 12, font: "inherit", fontSize: 15, fontWeight: 700,
              border: "1px solid var(--danger)", background: "var(--danger)", color: "#fff", cursor: "pointer",
            }}
          >
            Withdraw
          </button>
        </div>
      </div>
    </div>
  );
}

function Banner({ tone, children }: { tone: "danger" | "warn" | "info"; children: React.ReactNode }) {
  const t = tone === "warn" ? "warning" : tone;
  return (
    <div
      style={{
        background: `var(--${t}-bg)`, color: `var(--${t}-fg)`, borderRadius: 10,
        padding: "10px 12px", fontSize: 13, lineHeight: 1.5, marginBottom: 12,
      }}
    >
      {children}
    </div>
  );
}
