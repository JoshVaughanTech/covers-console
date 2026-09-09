"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { SignIn, type Signed } from "../../sign-in";
import { Banner, DUTY_LABEL, PayPanel, aud, type Sent, type Shift } from "../parts";

/* ============================================================
   One shift, at its own address.

   This was a bottom sheet over the board. Everything it showed was
   right; what it did not have was a URL, and that turned out to be
   the load-bearing part.

   A shift with no address cannot be linked to, cannot be reopened
   after a reload, cannot be sent to somebody, and — the one that
   actually costs a worker something — cannot be the destination of
   the notification about it. public/sw.js has carried `postingId`
   in every push payload since push was built, and threw it away on
   click because /m/shifts was the only place to go. "Bartender,
   Friday, $41.50/h" woke a phone and then handed over a list.

   So the sheet is gone rather than kept alongside this. Two ways to
   render one shift is the shape this repo has already been bitten
   by twice — a queue showing one person twice, a card and a sheet
   disagreeing about a date — and the second copy is never the one
   you remember to change.

   Everything on this screen arrives computed from
   GET /api/shifts/[id], which shares its mapping with the board.
   The phone does no rate arithmetic and makes no eligibility
   decision of its own: the button is drawn from the server's answer
   and the claim endpoint refuses independently.
   ============================================================ */

interface Payload {
  worker: { did: string; name: string; role: string };
  at: string;
  shift: Shift;
}

export default function ShiftDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const [me, setMe] = useState<Signed | null>(null);
  const [ready, setReady] = useState(false);
  const [payload, setPayload] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gone, setGone] = useState(false);
  const [sent, setSent] = useState<Sent | null>(null);

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
    if (!id) return;
    try {
      const res = await fetch(`/api/shifts/${encodeURIComponent(id)}`);
      if (res.status === 404) {
        /* Separate from `error` on purpose. "This shift is gone" is an answer;
           "the board would not load" is a failure, and offering a retry for the
           first one sends somebody round a loop that cannot succeed. */
        setGone(true);
        return;
      }
      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
      setPayload(await res.json());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load this shift");
    }
  }, [id]);

  useEffect(() => {
    if (me) void load();
  }, [me, load]);

  async function claim() {
    const s = payload?.shift;
    if (!s) return;
    setSent({ state: "sending" });
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
      setSent({ state: "ok" });
      /* Reload rather than patching the shift locally. The claim changed what
         this person may now do with it, and the server is the thing that
         knows — a screen that updates itself is a second opinion. */
      await load();
    } catch (e) {
      setSent({ state: "failed", reason: e instanceof Error ? e.message : "failed" });
    }
  }

  if (!ready) return null;
  if (!me) return <SignIn onSignedIn={setMe} />;

  const s = payload?.shift ?? null;

  return (
    <div style={{ padding: "14px 14px 28px" }}>
      <Link
        href="/m/shifts"
        style={{
          display: "inline-block", marginBottom: 12, fontSize: 13.5, fontWeight: 600,
          color: "var(--fg-3)", textDecoration: "none",
        }}
      >
        ← Open shifts
      </Link>

      {gone && (
        <>
          <h1 style={{ margin: "0 0 6px", fontSize: 20, letterSpacing: "-.02em" }}>That shift isn&rsquo;t here</h1>
          <p style={{ margin: "0 0 14px", fontSize: 13.5, color: "var(--fg-3)", lineHeight: 1.5 }}>
            It may have been filled, pulled by the venue, or never published. The board has what is going now.
          </p>
          <Link href="/m/shifts" style={primary}>
            Back to open shifts
          </Link>
        </>
      )}

      {error && !gone && (
        <>
          <Banner tone="danger">{error}</Banner>
          <button onClick={() => void load()} style={{ ...primary, border: "1px solid var(--border-2)", background: "#fff", color: "var(--fg-2)", cursor: "pointer" }}>
            Try again
          </button>
        </>
      )}

      {!payload && !error && !gone && (
        <p style={{ fontSize: 13, color: "var(--fg-4)" }}>Loading this shift…</p>
      )}

      {s && (
        <>
          <h1 style={{ margin: "0 0 2px", fontSize: 22, letterSpacing: "-.02em" }}>{s.role}</h1>
          <p style={{ margin: "0 0 14px", fontSize: 13, color: "var(--fg-4)" }}>
            {s.functionName}
            {s.client && ` · ${s.client}`}
          </p>

          <dl
            style={{
              margin: "0 0 14px", display: "grid", gridTemplateColumns: "auto 1fr",
              gap: "7px 14px", fontSize: 13.5,
            }}
          >
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

          {s.pay ? (
            <PayPanel pay={s.pay} />
          ) : (
            /* Said rather than left blank. A shift with no rate is a real state
               — the venue has not set one — and an empty space where the money
               goes reads as a page that failed to load. */
            <Banner tone="info">
              <strong>No rate published yet.</strong>
              <span style={{ display: "block", marginTop: 4 }}>
                The venue has not set what this shift pays. It cannot be posted below the award floor.
              </span>
            </Banner>
          )}

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

          {/* The commitments this creates live on My shifts, which is where
              withdrawing lives too. Pointing at it rather than repeating it:
              the board already made that split, and one fact belongs on one
              screen. */}
          {(s.rostered || s.standing?.standing === "open") && (
            <Link
              href="/m/mine"
              style={{
                display: "block", marginBottom: 12, padding: "11px 13px", borderRadius: 12,
                border: "1px solid var(--border-2)", background: "#fff", textDecoration: "none",
                fontSize: 13.5, fontWeight: 600, color: "var(--fg-2)",
              }}
            >
              Manage this on My shifts
            </Link>
          )}

          {s.claimable && (
            <button
              onClick={() => void claim()}
              disabled={sent?.state === "sending"}
              style={{
                ...primary,
                border: "1px solid var(--accent, var(--fg-1))",
                background: "var(--accent, var(--fg-1))",
                color: "#fff",
                cursor: sent?.state === "sending" ? "default" : "pointer",
                opacity: sent?.state === "sending" ? 0.7 : 1,
              }}
            >
              {sent?.state === "sending" ? "Sending…" : "Put my hand up"}
            </button>
          )}

          {s.pay && (
            <p style={{ margin: "14px 0 0", fontSize: 11.5, lineHeight: 1.55, color: "var(--fg-4)" }}>
              Est. {aud(s.pay.estGrossCents)} is for {s.pay.paidHours} paid hours at the rate this venue published.
              What you are actually paid comes from your venue&rsquo;s payroll, not from Covers.
            </p>
          )}
        </>
      )}
    </div>
  );
}

const primary: React.CSSProperties = {
  display: "block", width: "100%", minHeight: 50, lineHeight: "50px",
  borderRadius: 12, fontSize: 15, fontWeight: 700, textAlign: "center",
  textDecoration: "none", border: "1px solid var(--accent, var(--fg-1))",
  background: "var(--accent, var(--fg-1))", color: "#fff",
};
