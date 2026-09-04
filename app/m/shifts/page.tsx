"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { SignIn, type Signed } from "../sign-in";
import { MobileNav } from "../nav";
import { PushToggle } from "../push";

/* ============================================================
   Open shifts, in the hand of the person who would work them.

   Until now the marketplace had one side. The console could post a
   shift and rank who fits, and "Staff view" showed a manager what a
   worker would see — by picking that worker from a dropdown. Nobody
   could actually put their hand up.

   Two decisions shape this screen.

   Shifts the worker cannot take are shown, with the reason, rather
   than filtered out. A thin board with no stated cause reads as "no
   work going"; "RSA expired 2 May" reads as something to fix, and it
   is the same sentence the manager sees. It also means the count on
   this screen and the count in the console describe one world.

   And the button is not the gate. It is drawn from the server's
   answer and the server refuses independently, because a phone is a
   different process on a network the venue does not control. Keeping
   the check here too is not redundancy: it is how a blocked worker
   learns why before tapping rather than after.
   ============================================================ */

type Standing = "open" | "declined" | "lapsed" | "assigned";

/**
 * What the shift pays, already checked against the award by the server.
 *
 * Every figure here arrives computed. The phone does no rate arithmetic of its
 * own on purpose: "above award" on this card has to be the same answer that
 * stopped the venue posting below it, and two implementations of the same sum
 * is how they come to disagree. Null means no rate is published yet — which
 * the card says, rather than showing a number nobody set.
 */
interface Pay {
  offeredHourlyCents: number;
  floorHourlyCents: number;
  marginHourlyCents: number;
  estGrossCents: number;
  paidHours: number;
  unpaidHours: number;
  atOrAboveFloor: boolean;
  bands: { band: string; label: string; hours: number; hourlyCents: number }[];
  mixedRates: boolean;
  awardId: string;
  publicHolidaysChecked: boolean;
  summary: string;
  notModelled: string[];
}

/** 4150 → "$41.50". Formatting only; the arithmetic happened on the server. */
const aud = (cents: number) => {
  const sign = cents < 0 ? "-" : "";
  const a = Math.abs(cents);
  return `${sign}$${Math.floor(a / 100)}.${String(a % 100).padStart(2, "0")}`;
};

interface Shift {
  id: string;
  role: string;
  functionName: string;
  client: string | null;
  siteId: string;
  siteName: string;
  day: string;
  window: string;
  seats: number;
  seatsLeft: number;
  duties: string[];
  requires: { skill: string; level: string }[];
  /** null until the venue publishes a rate. */
  pay: Pay | null;
  status: string;
  blockReason: string | null;
  standing: { standing: Standing; at: string; reason: string | null } | null;
  /** already on the roster for this shift, claim or no claim. */
  rostered: boolean;
  claimable: boolean;
}

interface Payload {
  worker: { did: string; name: string; role: string };
  at: string;
  shifts: Shift[];
}

/** A claim this device has sent, and what became of it. */
interface Sent {
  state: "sending" | "ok" | "failed";
  reason?: string;
}

const DUTY_LABEL: Record<string, string> = {
  serve_alcohol: "Serve alcohol",
  handle_food: "Handle food",
  gaming: "Gaming",
  supervise: "Supervise",
};

export default function MobileShiftsPage() {
  const [me, setMe] = useState<Signed | null>(null);
  const [ready, setReady] = useState(false);
  const [payload, setPayload] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [sent, setSent] = useState<Record<string, Sent>>({});

  /* Who is holding this phone is the server’s answer, not the device’s.
     A name in localStorage was an assertion; a session cookie is a claim
     something checked. */
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

  /* What this phone has been told about, and how much of it is new.

     Kept separate from the board rather than derived from it. "New since you
     last looked" is a fact about this person's attention, not about the
     shifts — two workers opening the same board should not see the same
     things marked new, and the board cannot know the difference. */
  const [unseen, setUnseen] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/shifts");
      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
      setPayload(await res.json());
      setError(null);

      const n = await fetch("/api/notifications");
      if (n.ok) {
        const body = (await n.json()) as { offers: { postingId: string; seenAt: string | null }[] };
        setUnseen(new Set(body.offers.filter((o) => !o.seenAt).map((o) => o.postingId)));
      }
    } catch (e) {
      // a board that fails to load must say so; a silent empty list reads as
      // "no work going", which is a different and wrong answer
      setError(e instanceof Error ? e.message : "Could not load shifts");
    }
  }, []);

  useEffect(() => {
    if (me) void load();
  }, [me, load]);

  const groups = useMemo(() => {
    const all = payload?.shifts ?? [];
    return {
      // rostered, not "standing assigned": a manager can put someone on a
      // shift they never claimed, and that person is just as on it
      available: all
        .filter((s) => s.claimable)
        // new first: the whole point of being told is not having to hunt
        .sort((a, b) => Number(unseen.has(b.id)) - Number(unseen.has(a.id))),
      blocked: all.filter((s) => s.blockReason && !s.rostered),
      // a count only; the board points at them and never re-renders them
      mine: all.filter((s) => s.rostered || s.standing?.standing === "open").length,
    };
  }, [payload, unseen]);

  async function claim(s: Shift) {
    if (!me) return;
    setSent((x) => ({ ...x, [s.id]: { state: "sending" } }));
    // one ref per tap: a retry of THIS attempt is idempotent, while asking
    // again after a decline is deliberately a new request
    const clientRef = `${s.id}:${Date.now()}`;
    try {
      const res = await fetch("/api/shifts/claim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ postingId: s.id, clientRef }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setSent((x) => ({ ...x, [s.id]: { state: "ok" } }));
      setOpen(null);
      await load();
    } catch (e) {
      setSent((x) => ({
        ...x,
        [s.id]: { state: "failed", reason: e instanceof Error ? e.message : "failed" },
      }));
    }
  }

  if (!ready) return null;
  if (!me) return <SignIn onSignedIn={setMe} />;

  const active = open ? (payload?.shifts ?? []).find((s) => s.id === open) ?? null : null;

  return (
    <div style={{ padding: "14px 14px 28px" }}>
      <header style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 14 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ margin: 0, fontSize: 21, letterSpacing: "-.02em" }}>Open shifts</h1>
          <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--fg-4)" }}>
            {me.role} · eligibility checked {payload?.at ?? "…"}
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

      <MobileNav current="/m/shifts" />

      {unseen.size > 0 && (
        <button
          onClick={() => {
            /* Marked when they act, not when the list renders. A badge that
               clears itself on load tells you something arrived and then
               removes the only way to find out what — and on a phone that
               woke up in a pocket, nobody saw it at all. */
            void fetch("/api/notifications", { method: "POST" }).finally(() => setUnseen(new Set()));
          }}
          style={{
            width: "100%", marginBottom: 14, padding: "11px 13px", borderRadius: 12,
            border: "1px solid var(--info)", background: "var(--info-bg)",
            color: "var(--info-fg)", fontSize: 13.5, fontWeight: 600,
            textAlign: "left", cursor: "pointer",
          }}
        >
          {unseen.size} new shift{unseen.size === 1 ? "" : "s"} for you
          <span style={{ display: "block", fontWeight: 400, fontSize: 12.5, marginTop: 2, opacity: 0.85 }}>
            Tap to mark as read
          </span>
        </button>
      )}

      <PushToggle />

      {error && <Banner tone="danger">{error}</Banner>}

      {!payload && !error && <p style={{ fontSize: 13, color: "var(--fg-4)" }}>Loading the board…</p>}

      {payload && groups.available.length === 0 && (
        <Banner tone="info">
          {groups.blocked.length > 0
            ? `Nothing you can take right now. ${groups.blocked.length} shift${groups.blocked.length === 1 ? "" : "s"} below need something you don't hold yet.`
            : "No open shifts at the moment."}
        </Banner>
      )}

      {/* Shifts this person is already on, or has claimed, live on My shifts.
          They were listed here too until this screen and that one disagreed
          about the same shift; one fact belongs on one screen. */}
      {payload && (groups.mine > 0) && (
        <Link href="/m/mine" style={mineLink}>
          {groups.mine} of yours {groups.mine === 1 ? "is" : "are"} on My shifts
        </Link>
      )}

      {groups.available.length > 0 && (
        <Section title={`Available to you (${groups.available.length})`}>
          {groups.available.map((s) => (
            <Row key={s.id} s={s} sent={sent[s.id]} isNew={unseen.has(s.id)} onTap={() => setOpen(s.id)} />
          ))}
        </Section>
      )}

      {groups.blocked.length > 0 && (
        <Section title={`Not available to you (${groups.blocked.length})`}>
          {groups.blocked.map((s) => <Row key={s.id} s={s} onTap={() => setOpen(s.id)} />)}
        </Section>
      )}

      {active && (
        <Sheet
          s={active}
          sent={sent[active.id]}
          onClose={() => setOpen(null)}
          onClaim={() => claim(active)}
        />
      )}
    </div>
  );
}

/* ---------- pieces ---------- */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 18 }}>
      <h2
        style={{
          margin: "0 0 8px", fontSize: 11.5, fontWeight: 700, letterSpacing: ".06em",
          textTransform: "uppercase", color: "var(--fg-4)",
        }}
      >
        {title}
      </h2>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{children}</div>
    </section>
  );
}

function Banner({ tone, children }: { tone: "danger" | "warn" | "success" | "info"; children: React.ReactNode }) {
  const bg = `var(--${tone === "warn" ? "warning" : tone}-bg)`;
  const fg = `var(--${tone === "warn" ? "warning" : tone}-fg)`;
  return (
    <div
      style={{
        background: bg, color: fg, borderRadius: 10, padding: "10px 12px",
        fontSize: 13, lineHeight: 1.5, marginBottom: 12,
      }}
    >
      {children}
    </div>
  );
}

function Row({ s, sent, isNew, onTap }: { s: Shift; sent?: Sent; isNew?: boolean; onTap: () => void }) {
  const blocked = Boolean(s.blockReason);
  return (
    <button
      onClick={onTap}
      style={{
        display: "block", width: "100%", textAlign: "left", minHeight: 56,
        padding: "11px 13px", borderRadius: 12, cursor: "pointer",
        border: `1px solid ${blocked ? "var(--border)" : "var(--border-2)"}`,
        background: "#fff",
        // blocked rows stay legible rather than greyed to the point of unreadable:
        // the reason is the useful part of the row
        opacity: blocked ? 0.82 : 1,
      }}
    >
      <span style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
        <span style={{ fontSize: 15, fontWeight: 600, color: "var(--fg-1)" }}>
          {s.role}
          {isNew && (
            <span
              style={{
                marginLeft: 8, fontSize: 10.5, fontWeight: 700, letterSpacing: ".06em",
                textTransform: "uppercase", color: "var(--info-fg)", background: "var(--info-bg)",
                borderRadius: 999, padding: "2px 7px", verticalAlign: "middle",
              }}
            >
              New
            </span>
          )}
        </span>
        {/* The rate, where the eye lands. Someone scanning for work is
            deciding on money and time before anything else, and burying it
            under the venue name makes them open five shifts to compare two. */}
        <span style={{ textAlign: "right", whiteSpace: "nowrap", flexShrink: 0 }}>
          {s.pay ? (
            <>
              <span className="fs-tnum" style={{ display: "block", fontSize: 15, fontWeight: 700, color: "var(--fg-1)" }}>
                {aud(s.pay.offeredHourlyCents)}
                <span style={{ fontSize: 11, fontWeight: 500, color: "var(--fg-4)" }}>/h</span>
              </span>
              <span style={{ display: "block", fontSize: 11, color: "var(--fg-4)" }}>{s.day}</span>
            </>
          ) : (
            <span style={{ fontSize: 12, color: "var(--fg-4)" }}>{s.day}</span>
          )}
        </span>
      </span>
      <span style={{ display: "block", fontSize: 12.5, color: "var(--fg-3)", marginTop: 2 }}>
        {s.functionName} · {s.window}
      </span>
      <span style={{ display: "block", fontSize: 12, color: "var(--fg-4)", marginTop: 2 }}>
        {s.siteName}
        {s.seatsLeft > 0 && ` · ${s.seatsLeft} of ${s.seats} left`}
      </span>

      {s.pay && (
        <span style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 7, alignItems: "center" }}>
          {/* "Above award" is only worth printing because something refused to
              publish this shift below it. The floor is named next to it so the
              claim is checkable rather than a badge. */}
          {s.pay.atOrAboveFloor && s.pay.marginHourlyCents > 0 && (
            <span style={chip("success")}>✓ {aud(s.pay.marginHourlyCents)}/h above award</span>
          )}
          {s.pay.atOrAboveFloor && s.pay.marginHourlyCents === 0 && <span style={chip("info")}>At the award floor</span>}
          <span style={{ fontSize: 11.5, color: "var(--fg-4)" }}>
            floor {aud(s.pay.floorHourlyCents)}
            {s.pay.mixedRates && " · mixed rates"}
          </span>
        </span>
      )}
      {s.pay && (
        <span style={{ display: "block", fontSize: 12, color: "var(--fg-3)", marginTop: 5 }}>
          Est. <strong style={{ color: "var(--fg-1)" }}>{aud(s.pay.estGrossCents)}</strong> for {s.pay.paidHours}h
        </span>
      )}
      {!s.pay && (
        <span style={{ display: "block", fontSize: 12, color: "var(--fg-4)", marginTop: 5, fontStyle: "italic" }}>
          Rate not published yet
        </span>
      )}

      {s.blockReason && (
        <span
          style={{
            display: "block", marginTop: 7, fontSize: 12, fontWeight: 600,
            color: "var(--warning-fg)", background: "var(--warning-bg)",
            borderRadius: 8, padding: "5px 8px",
          }}
        >
          {s.blockReason}
        </span>
      )}
      {s.rostered && <Pill tone="success">You&rsquo;re on this shift</Pill>}
      {!s.rostered && s.standing?.standing === "open" && <Pill tone="info">Claimed — waiting on the manager</Pill>}
      {s.standing?.standing === "declined" && <Pill tone="warning">{s.standing.reason ?? "Not needed"}</Pill>}
      {sent?.state === "failed" && <Pill tone="danger">{sent.reason}</Pill>}
    </button>
  );
}

/**
 * The award maths, shown rather than summarised.
 *
 * The point of this panel is that a casual can check it. "Above award" as a
 * badge is a marketing claim; the same badge next to the floor it beat, the
 * hours it was worked out over, and the clause it comes from is something a
 * person can argue with — which is the only version worth putting in front of
 * someone whose pay it describes.
 *
 * It also says what it does not cover. A gross figure that quietly excludes
 * overtime and allowances, presented as "your pay", is the kind of number that
 * is believed until payday.
 */
function PayPanel({ pay }: { pay: Pay }) {
  return (
    <section
      style={{
        background: "var(--fs-navy, #0a1a28)", color: "#fff", borderRadius: 14,
        padding: "14px 15px", margin: "0 0 14px",
      }}
    >
      {/* globals.css colours h3 and p with --fg-1 / --fg-2, which are dark by
          design and invisible on this panel. Inheritance does not reach them,
          so every element here states its own colour. */}
      <h3
        style={{
          margin: 0, fontSize: 10.5, fontWeight: 700, letterSpacing: ".08em",
          textTransform: "uppercase", color: "#fff", opacity: 0.65,
        }}
      >
        Your pay for this shift
      </h3>

      <p style={{ margin: "6px 0 0", display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", color: "#fff" }}>
        <span className="fs-tnum" style={{ fontSize: 30, fontWeight: 800, letterSpacing: "-.02em" }}>
          {aud(pay.estGrossCents)}
        </span>
        <span style={{ fontSize: 12.5, opacity: 0.7 }}>
          est. gross · {pay.paidHours}h at {aud(pay.offeredHourlyCents)}/h
        </span>
      </p>

      {/* Per band, because this is the part a single rate hides: an eight-hour
          Friday that runs past midnight is not eight Friday hours. */}
      <ul style={{ margin: "12px 0 0", padding: 0, listStyle: "none", fontSize: 12.5, color: "#fff" }}>
        {pay.bands.map((b) => (
          <li key={b.band} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "3px 0" }}>
            <span style={{ opacity: 0.75 }}>
              {b.label} · {b.hours}h
            </span>
            <span className="fs-tnum" style={{ fontWeight: 600, whiteSpace: "nowrap" }}>
              award {aud(b.hourlyCents)}/h
            </span>
          </li>
        ))}
        {/* The rows above cover the shift end to end, so they have to be
            reconciled with the paid hours rather than quietly not adding up. */}
        {pay.unpaidHours > 0 && (
          <li style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "3px 0", opacity: 0.75 }}>
            <span>Unpaid meal break</span>
            <span className="fs-tnum" style={{ whiteSpace: "nowrap" }}>−{pay.unpaidHours}h</span>
          </li>
        )}
      </ul>

      <p
        style={{
          margin: "12px 0 0", padding: "9px 10px", borderRadius: 9, fontSize: 12.5, lineHeight: 1.5,
          background: pay.atOrAboveFloor ? "rgba(18,217,198,.14)" : "rgba(255,120,120,.16)",
          color: pay.atOrAboveFloor ? "var(--fs-teal-bright, #12d9c6)" : "#ffb4b4",
          fontWeight: 600,
        }}
      >
        {pay.atOrAboveFloor
          ? `✓ ${aud(pay.offeredHourlyCents)}/h clears the ${pay.awardId} floor for every hour of this shift — the dearest hour is ${aud(pay.floorHourlyCents)}/h.`
          : `This rate is below the ${pay.awardId} floor of ${aud(pay.floorHourlyCents)}/h.`}
      </p>

      <p style={{ margin: "10px 0 0", fontSize: 11, lineHeight: 1.5, color: "#fff", opacity: 0.6 }}>
        {pay.awardId} cl 18 &amp; 29. Estimate for ordinary hours — excludes {pay.notModelled.slice(0, 3).join(", ")} and
        super.
        {!pay.publicHolidaysChecked && " Public holidays are not checked for this site."}
      </p>
    </section>
  );
}

const mineLink: React.CSSProperties = {
  display: "block", marginBottom: 14, padding: "11px 13px", borderRadius: 12,
  border: "1px solid var(--border-2)", background: "#fff", textDecoration: "none",
  fontSize: 13.5, fontWeight: 600, color: "var(--fg-2)",
};

const chip = (tone: string): React.CSSProperties => ({
  fontSize: 11.5, fontWeight: 700, borderRadius: 999, padding: "3px 8px",
  color: `var(--${tone}-fg)`, background: `var(--${tone}-bg)`,
});

function Pill({ tone, children }: { tone: string; children: React.ReactNode }) {
  return (
    <span
      style={{
        display: "inline-block", marginTop: 7, fontSize: 11.5, fontWeight: 600,
        color: `var(--${tone}-fg)`, background: `var(--${tone}-bg)`,
        borderRadius: 999, padding: "4px 9px",
      }}
    >
      {children}
    </span>
  );
}

function Sheet({
  s, sent, onClose, onClaim,
}: {
  s: Shift;
  sent?: Sent;
  onClose: () => void;
  onClaim: () => void;
}) {
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,.34)",
        display: "flex", alignItems: "flex-end", zIndex: 40,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%", background: "var(--bg)", borderRadius: "16px 16px 0 0",
          padding: "18px 16px calc(18px + env(safe-area-inset-bottom))",
          maxHeight: "86dvh", overflowY: "auto",
        }}
      >
        <h2 style={{ margin: "0 0 2px", fontSize: 19, letterSpacing: "-.02em" }}>{s.role}</h2>
        <p style={{ margin: "0 0 14px", fontSize: 13, color: "var(--fg-4)" }}>
          {s.functionName}
          {s.client && ` · ${s.client}`}
        </p>

        <dl style={{ margin: "0 0 14px", display: "grid", gridTemplateColumns: "auto 1fr", gap: "7px 14px", fontSize: 13.5 }}>
          <dt style={{ color: "var(--fg-4)" }}>When</dt>
          <dd style={{ margin: 0 }}>{s.day} · {s.window}</dd>
          <dt style={{ color: "var(--fg-4)" }}>Where</dt>
          <dd style={{ margin: 0 }}>{s.siteName}</dd>
          <dt style={{ color: "var(--fg-4)" }}>Seats</dt>
          <dd style={{ margin: 0 }}>{s.seatsLeft} of {s.seats} still open</dd>
          {s.duties.length > 0 && (
            <>
              <dt style={{ color: "var(--fg-4)" }}>Involves</dt>
              <dd style={{ margin: 0 }}>{s.duties.map((d) => DUTY_LABEL[d] ?? d).join(", ")}</dd>
            </>
          )}
        </dl>

        {s.pay && <PayPanel pay={s.pay} />}

        {s.blockReason && (
          <Banner tone="warn">
            <strong>You can&rsquo;t take this one yet.</strong>
            <span style={{ display: "block", marginTop: 4 }}>{s.blockReason}</span>
          </Banner>
        )}
        {s.rostered && <Banner tone="success">You&rsquo;re rostered on this shift.</Banner>}
        {!s.rostered && s.standing?.standing === "open" && (
          <Banner tone="info">Your claim is in. The manager decides who gets the seat.</Banner>
        )}
        {s.standing?.standing === "declined" && (
          <Banner tone="warn">{s.standing.reason ?? "You weren't needed for this one."}</Banner>
        )}
        {sent?.state === "failed" && <Banner tone="danger">{sent.reason}</Banner>}

        <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
          <button
            onClick={onClose}
            style={{
              flex: 1, minHeight: 50, borderRadius: 12, fontSize: 15, fontWeight: 600,
              border: "1px solid var(--border-2)", background: "#fff", color: "var(--fg-2)", cursor: "pointer",
            }}
          >
            Close
          </button>
          {s.claimable && (
            <button
              onClick={onClaim}
              disabled={sent?.state === "sending"}
              style={{
                flex: 2, minHeight: 50, borderRadius: 12, fontSize: 15, fontWeight: 700,
                border: "1px solid var(--accent, var(--fg-1))",
                background: "var(--accent, var(--fg-1))", color: "#fff",
                cursor: sent?.state === "sending" ? "default" : "pointer",
                opacity: sent?.state === "sending" ? 0.7 : 1,
              }}
            >
              {sent?.state === "sending" ? "Sending…" : "Put my hand up"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
