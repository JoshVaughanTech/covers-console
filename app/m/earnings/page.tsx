"use client";

import { useCallback, useEffect, useState } from "react";
import { SignIn, type Signed } from "../sign-in";
import { MobileNav } from "../nav";

/* ============================================================
   Earnings — what the clock says the work was worth.

   The hard part of this screen is what it refuses to be. It is
   called Earnings, it shows a large dollar figure, and a worker will
   read that figure as money coming to them. Nothing in Covers
   records what a completed shift was PAID: the clock records when
   they started and stopped, and the award says what those hours are
   worth as a minimum.

   So the headline is labelled as a floor everywhere it appears, and
   the screen says plainly what it excludes — tax, super, and
   anything actually paid. A "net pay" number Covers had not seen a
   payment for would be the worst thing on this phone, because it is
   the one a person would budget against.

   What it CAN do, and no payslip does: show the award working. Each
   shift breaks into the bands it crossed, and any cl 16.6 loading
   the venue owes appears as its own line with the clause on it — the
   same figure the venue's own Break Board shows, so the two cannot
   disagree about what is owed.
   ============================================================ */

interface Band {
  band: string;
  /** the weekday evening or night loading, where one applied. */
  adder: string | null;
  hours: number;
  hourly: string;
  hourlyCents: number;
  /** what these hours came to. Rendered, never recomputed — the part-hour
      loading means hours × rate does not reproduce it. */
  amount: string;
  cents: number;
}

interface Shift {
  id: string;
  role: string;
  siteName: string;
  clockIn: number;
  clockOut: number;
  paidHours: number;
  unpaidBreakHours: number;
  bands: Band[];
  award: string;
  awardCents: number;
  loading: { clause: string; hours: number; amount: string; cents: number } | null;
  total: string;
  totalCents: number;
}

interface Payload {
  worker: { did: string; name: string; role: string };
  classified: boolean;
  reason?: string;
  award?: { awardId: string; levelLabel: string; employment: string };
  week?: { start: number; end: number };
  basis?: string;
  period: {
    shifts: Shift[];
    paidHours: number;
    award: string;
    loading: string;
    loadingCents: number;
    total: string;
    unpriced: number;
  } | null;
  excludes?: string[];
}

const TZ = "Australia/Melbourne";
const clock = (ts: number) =>
  new Date(ts * 1000).toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TZ });
const dayLabel = (ts: number) =>
  new Date(ts * 1000).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", timeZone: TZ });

const BAND_LABEL: Record<string, string> = {
  ordinary: "Weekday",
  saturday: "Saturday",
  sunday: "Sunday",
  public_holiday: "Public holiday",
};

const EMPLOYMENT: Record<string, string> = {
  casual: "Casual",
  full_time: "Full-time",
  part_time: "Part-time",
};

export default function EarningsPage() {
  const [me, setMe] = useState<Signed | null>(null);
  const [ready, setReady] = useState(false);
  const [payload, setPayload] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

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
      const res = await fetch("/api/earnings");
      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
      setPayload(await res.json());
      setError(null);
    } catch (e) {
      // a zero total and a failed load look identical, and one of them is a
      // much worse thing to tell somebody about their pay
      setError(e instanceof Error ? e.message : "Could not load your earnings");
    }
  }, []);

  useEffect(() => {
    if (me) void load();
  }, [me, load]);

  if (!ready) return null;
  if (!me) return <SignIn onSignedIn={setMe} />;

  const p = payload?.period;

  return (
    <div style={{ padding: "14px 14px 28px" }}>
      <header style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 14 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ margin: 0, fontSize: 21, letterSpacing: "-.02em" }}>Earnings</h1>
          <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--fg-4)" }}>
            {payload?.week
              ? `${dayLabel(payload.week.start)} – ${dayLabel(payload.week.end - 86400)}`
              : "From your time clock"}
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

      <MobileNav current="/m/earnings" />

      {error && <Banner tone="danger">{error}</Banner>}
      {!payload && !error && <p style={{ fontSize: 13, color: "var(--fg-4)" }}>Working out your hours…</p>}

      {payload && !payload.classified && (
        <Banner tone="warn">
          <strong>Nothing to price yet.</strong>
          <span style={{ display: "block", marginTop: 4 }}>{payload.reason}</span>
        </Banner>
      )}

      {p && (
        <>
          {/* The headline, and the sentence that stops it being a payslip. */}
          <section
            style={{
              background: "var(--fs-navy, #0a1a28)", color: "#fff", borderRadius: 14,
              padding: "15px 16px", marginBottom: 14,
            }}
          >
            <h2
              style={{
                margin: 0, fontSize: 10.5, fontWeight: 700, letterSpacing: ".08em",
                textTransform: "uppercase", color: "#fff", opacity: 0.65,
              }}
            >
              Award value of hours you worked
            </h2>
            <p style={{ margin: "6px 0 0", display: "flex", alignItems: "baseline", gap: 9, flexWrap: "wrap", color: "#fff" }}>
              <span className="fs-tnum" style={{ fontSize: 33, fontWeight: 800, letterSpacing: "-.02em" }}>
                {p.total}
              </span>
              <span style={{ fontSize: 12.5, opacity: 0.7 }}>{p.paidHours}h paid</span>
            </p>

            <ul style={{ margin: "12px 0 0", padding: 0, listStyle: "none", fontSize: 12.5, color: "#fff" }}>
              <li style={{ display: "flex", justifyContent: "space-between", padding: "3px 0" }}>
                <span style={{ opacity: 0.75 }}>Hours at award rates</span>
                <span className="fs-tnum" style={{ fontWeight: 600 }}>{p.award}</span>
              </li>
              {p.loadingCents > 0 && (
                <li style={{ display: "flex", justifyContent: "space-between", padding: "3px 0" }}>
                  <span style={{ opacity: 0.75 }}>Break loading owed · cl 16.6</span>
                  <span className="fs-tnum" style={{ fontWeight: 600 }}>{p.loading}</span>
                </li>
              )}
            </ul>

            <p style={{ margin: "12px 0 0", fontSize: 11.5, lineHeight: 1.55, color: "#fff", opacity: 0.62 }}>
              This is the <strong>legal minimum</strong> for the hours your time clock recorded, under{" "}
              {payload?.award?.awardId} for a {payload?.award?.levelLabel}{" "}
              {(EMPLOYMENT[payload?.award?.employment ?? ""] ?? "").toLowerCase()}. Your venue may pay more.
              It excludes {payload?.excludes?.join(", ")}.
            </p>
          </section>

          {p.unpriced > 0 && (
            <Banner tone="warn">
              {p.unpriced} shift{p.unpriced === 1 ? "" : "s"} could not be priced — no award rates on file for
              those dates. {p.unpriced === 1 ? "It is" : "They are"} not in the total above.
            </Banner>
          )}

          {p.shifts.length === 0 && <Banner tone="info">No clocked shifts in this week.</Banner>}

          {p.shifts.map((s) => (
            <button
              key={s.id}
              onClick={() => setOpen(open === s.id ? null : s.id)}
              style={{
                display: "block", width: "100%", textAlign: "left", font: "inherit", cursor: "pointer",
                border: "1px solid var(--border-2)", borderRadius: 12, background: "#fff",
                padding: "12px 13px", marginBottom: 10,
              }}
            >
              <span style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 15, fontWeight: 700, color: "var(--fg-1)" }}>{s.role}</span>
                  <span style={{ display: "block", fontSize: 12.5, color: "var(--fg-3)", marginTop: 2 }}>
                    {s.siteName} · {clock(s.clockIn)}–{clock(s.clockOut)}
                  </span>
                </span>
                <span style={{ textAlign: "right", flexShrink: 0 }}>
                  <span className="fs-tnum" style={{ display: "block", fontSize: 16, fontWeight: 800, color: "var(--fg-1)" }}>
                    {s.total}
                  </span>
                  <span style={{ display: "block", fontSize: 11, color: "var(--fg-4)" }}>
                    {dayLabel(s.clockIn)} · {s.paidHours}h
                  </span>
                </span>
              </span>

              {s.loading && (
                <span
                  style={{
                    display: "block", marginTop: 8, borderRadius: 8, padding: "6px 9px",
                    fontSize: 12, fontWeight: 600,
                    background: "var(--warning-bg)", color: "var(--warning-fg)",
                  }}
                >
                  Includes {s.loading.amount} break loading — cl {s.loading.clause}
                </span>
              )}

              {/* The award working, on tap. A payslip gives a worker a number;
                  this gives them the arithmetic behind it. */}
              {open === s.id && (
                <span style={{ display: "block", marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--border)" }}>
                  {s.bands.map((b) => (
                    <span
                      key={`${b.band}|${b.adder ?? ""}`}
                      style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "3px 0", fontSize: 12.5 }}
                    >
                      <span style={{ color: "var(--fg-3)", minWidth: 0 }}>
                        {BAND_LABEL[b.band] ?? b.band}
                        {b.adder && ` ${b.adder}`} · {b.hours}h @ {b.hourly}/h
                      </span>
                      <span className="fs-tnum" style={{ color: "var(--fg-2)", fontWeight: 600, whiteSpace: "nowrap" }}>
                        {b.amount}
                      </span>
                    </span>
                  ))}
                  {s.unpaidBreakHours > 0 && (
                    <span style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", fontSize: 12.5, color: "var(--fg-4)" }}>
                      <span>Unpaid meal break</span>
                      <span className="fs-tnum">−{s.unpaidBreakHours}h</span>
                    </span>
                  )}
                  <span style={{ display: "flex", justifyContent: "space-between", padding: "6px 0 0", fontSize: 12.5, fontWeight: 700 }}>
                    <span style={{ color: "var(--fg-2)" }}>Hours at award rates</span>
                    <span className="fs-tnum" style={{ color: "var(--fg-1)" }}>{s.award}</span>
                  </span>
                  {s.loading && (
                    <span style={{ display: "flex", justifyContent: "space-between", padding: "3px 0 0", fontSize: 12.5, color: "var(--warning-fg)" }}>
                      <span>Break loading · cl {s.loading.clause} · {s.loading.hours}h</span>
                      <span className="fs-tnum" style={{ fontWeight: 600 }}>{s.loading.amount}</span>
                    </span>
                  )}
                </span>
              )}
            </button>
          ))}

          <p style={{ margin: "16px 2px 0", fontSize: 11.5, lineHeight: 1.55, color: "var(--fg-4)" }}>
            Hours come from the venue&rsquo;s time clock and the rates from the Hospitality Award. Covers does not
            process your pay and does not see what reached your account — if these figures and your payslip
            disagree, this is the one with the award working shown.
          </p>
        </>
      )}
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
