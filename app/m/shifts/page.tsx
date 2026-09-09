"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { SignIn, type Signed } from "../sign-in";
import { MobileNav } from "../nav";
import { PushToggle } from "../push";
import { Banner, Pill, aud, chip, type Shift } from "./parts";

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

interface Payload {
  worker: { did: string; name: string; role: string };
  at: string;
  shifts: Shift[];
}

export default function MobileShiftsPage() {
  const [me, setMe] = useState<Signed | null>(null);
  const [ready, setReady] = useState(false);
  const [payload, setPayload] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  if (!ready) return null;
  if (!me) return <SignIn onSignedIn={setMe} />;

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
            <Row key={s.id} s={s} isNew={unseen.has(s.id)} />
          ))}
        </Section>
      )}

      {groups.blocked.length > 0 && (
        <Section title={`Not available to you (${groups.blocked.length})`}>
          {groups.blocked.map((s) => <Row key={s.id} s={s} />)}
        </Section>
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

function Row({ s, isNew }: { s: Shift; isNew?: boolean }) {
  const blocked = Boolean(s.blockReason);
  return (
    /* A link, not a button. The shift has an address now, so tapping it should
       behave like going somewhere: long-press to copy, open in a new tab, and
       a back button that returns to the board rather than closing a sheet the
       browser never knew about. */
    <Link
      href={`/m/shifts/${s.id}`}
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
    </Link>
  );
}

const mineLink: React.CSSProperties = {
  display: "block", marginBottom: 14, padding: "11px 13px", borderRadius: 12,
  border: "1px solid var(--border-2)", background: "#fff", textDecoration: "none",
  fontSize: 13.5, fontWeight: 600, color: "var(--fg-2)",
};
