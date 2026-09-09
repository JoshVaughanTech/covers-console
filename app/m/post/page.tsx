"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { MobileNav } from "../nav";
import {
  dutiesForRole,
  emptyDraft,
  payFromDraft,
  describePayFor,
  payBlockReasonFor,
  type PostingDraft,
} from "@/lib/shifts";
import { ROLE_FUNCTIONS } from "@/lib/idara/hospitality";
import { SITES } from "@/lib/idara/seed";
import { fmtAud, LEVELS, suggestedLevel, type EmploymentType } from "@/lib/awards";
import type { WorkFunction } from "@/lib/idara/types";

/* ============================================================
   Posting a shift from a phone.

   The console has done this since the marketplace was built, in a
   modal on a desktop screen. A duty manager standing on the floor
   at 6pm realising they are a bartender short is not at that
   screen, and the shift they cannot post is the one that most
   needed posting.

   OPERATORS ONLY, and that is not a UI decision. Posting commits a
   venue to paying somebody, and lib/auth/operators.ts keeps
   operators and workers as separate populations on purpose —
   "an operator is not a worker with a flag". Sophie Nguyen exists
   twice, once in each roster, and which sign-in she used decides
   what this screen will let her do. The server enforces it
   independently; this only avoids drawing a form that would be
   refused.

   The rate panel is not a preview in the sense of an estimate. It
   runs the same payFromDraft() → payBlockReasonFor() that
   POST /api/shifts/post runs, so it cannot promise something the
   server then refuses. What it is not is the gate: the gate is on
   the server, and it re-derives everything this screen sends.
   ============================================================ */

interface Me {
  kind: "worker" | "operator";
  name: string;
  role: string;
}

const TZ_LABEL = "venue local time";

export default function PostShiftPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);
  const [draft, setDraft] = useState<PostingDraft>(emptyDraft);
  const [errors, setErrors] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [posted, setPosted] = useState<{ role: string; functionName: string; status: string } | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const r = await fetch("/api/auth/session");
        const b = (await r.json()) as {
          signedIn: boolean;
          kind?: "worker" | "operator";
          worker?: { name: string; role: string };
          operator?: { name: string; role: string };
        };
        if (b.signedIn && b.kind === "operator" && b.operator) {
          setMe({ kind: "operator", name: b.operator.name, role: b.operator.role });
        } else if (b.signedIn && b.kind === "worker" && b.worker) {
          setMe({ kind: "worker", name: b.worker.name, role: b.worker.role });
        }
      } catch {
        /* offline: the sign-in prompt is the honest thing to show */
      } finally {
        setReady(true);
      }
    })();
  }, []);

  /* The display strings follow the real times rather than being typed beside
     them — the same rule the console form applies. Two fields describing one
     shift can disagree, and the one a worker reads is not the one the award is
     applied to. */
  const setTime = (patch: Partial<PostingDraft>) =>
    setDraft((d) => {
      const next = { ...d, ...patch };
      if (/^\d{4}-\d{2}-\d{2}$/.test(next.date)) {
        const [y, m, day] = next.date.split("-").map(Number);
        next.day = new Date(Date.UTC(y, m - 1, day)).toLocaleDateString("en-AU", {
          weekday: "short", day: "numeric", month: "short", timeZone: "UTC",
        });
      }
      if (next.startTime && next.endTime) next.window = `${next.startTime}–${next.endTime}`;
      return next;
    });

  const setRole = (role: string) =>
    setDraft((d) => ({ ...d, role, duties: dutiesForRole(role) }));

  const toggleDuty = (fn: WorkFunction) =>
    setDraft((d) => ({
      ...d,
      duties: d.duties.includes(fn) ? d.duties.filter((x) => x !== fn) : [...d.duties, fn],
    }));

  /* What the server will say, while they are still typing. The same two
     functions, not a second opinion computed for display. */
  const rate = useMemo(() => {
    const parsed = payFromDraft(draft);
    if (!parsed.ok) return { state: "incomplete" as const, errors: parsed.errors };
    if (!parsed.pay) return { state: "unset" as const };
    return { state: "priced" as const, summary: describePayFor(parsed.pay), blocked: payBlockReasonFor(parsed.pay) };
  }, [draft]);

  const hint = useMemo(() => (draft.role ? suggestedLevel(draft.role) : null), [draft.role]);

  const submit = useCallback(async () => {
    setSending(true);
    setErrors([]);
    try {
      const res = await fetch("/api/shifts/post", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...draft, clientRef: `${Date.now()}` }),
      });
      const body = (await res.json()) as { error?: string; errors?: string[]; posting?: { role: string; functionName: string; status: string } };
      if (res.status === 422) {
        setErrors(body.errors ?? [body.error ?? "The server refused this shift."]);
        return;
      }
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setPosted(body.posting ?? null);
      setDraft(emptyDraft());
    } catch (e) {
      setErrors([e instanceof Error ? e.message : "Could not post this shift"]);
    } finally {
      setSending(false);
    }
  }, [draft]);

  if (!ready) return null;

  /* Not signed in as an operator. Said plainly rather than shown as an empty
     form that fails on submit — and it names the other sign-in, because a
     venue manager holds two identities and the likeliest cause is having used
     the wrong one. */
  if (!me || me.kind !== "operator") {
    return (
      <div style={{ padding: "14px 14px 28px" }}>
        <h1 style={{ margin: "0 0 6px", fontSize: 21, letterSpacing: "-.02em" }}>Post a shift</h1>
        <p style={{ margin: "0 0 14px", fontSize: 13.5, color: "var(--fg-3)", lineHeight: 1.55 }}>
          {me
            ? `You're signed in as ${me.name} — ${me.role}. Posting a shift commits the venue to paying somebody, so it needs a venue sign-in rather than a staff one.`
            : "Posting a shift needs a venue sign-in."}
        </p>
        <Link
          href="/console-sign-in"
          style={{
            display: "block", width: "100%", minHeight: 50, lineHeight: "50px", textAlign: "center",
            borderRadius: 12, fontSize: 15, fontWeight: 700, textDecoration: "none",
            border: "1px solid var(--accent, var(--fg-1))", background: "var(--accent, var(--fg-1))", color: "#fff",
          }}
        >
          Sign in as the venue
        </Link>
      </div>
    );
  }

  if (posted) {
    return (
      <div style={{ padding: "14px 14px 28px" }}>
        <MobileNav current="/m/post" />
        <div style={{ background: "var(--success-bg)", color: "var(--success-fg)", borderRadius: 12, padding: "14px 15px", marginBottom: 14 }}>
          <strong style={{ display: "block", fontSize: 15 }}>
            {posted.status === "open" ? "Posted" : "Saved as a draft"}
          </strong>
          <span style={{ display: "block", marginTop: 4, fontSize: 13.5 }}>
            {posted.role} · {posted.functionName}
            {posted.status === "open" && " — everyone who can work it has been told."}
          </span>
        </div>
        <button onClick={() => setPosted(null)} style={primaryBtn}>Post another</button>
        <Link href="/m/shifts" style={{ ...secondaryLink, marginTop: 10 }}>See the board</Link>
      </div>
    );
  }

  return (
    <div style={{ padding: "14px 14px 28px" }}>
      <header style={{ marginBottom: 14 }}>
        <h1 style={{ margin: 0, fontSize: 21, letterSpacing: "-.02em" }}>Post a shift</h1>
        <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--fg-4)" }}>
          {me.name} · {me.role}
        </p>
      </header>

      <MobileNav current="/m/post" />

      {errors.length > 0 && (
        <div style={{ background: "var(--danger-bg)", color: "var(--danger-fg)", borderRadius: 12, padding: "11px 13px", marginBottom: 14, fontSize: 13, lineHeight: 1.5 }}>
          {errors.map((e) => <div key={e} style={{ marginBottom: 2 }}>{e}</div>)}
        </div>
      )}

      <Field label="Role">
        <select value={draft.role} onChange={(e) => setRole(e.target.value)} style={input}>
          <option value="">Pick a role</option>
          {Object.keys(ROLE_FUNCTIONS).map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </Field>

      <Row>
        <Field label="Seats">
          <input value={draft.seats} onChange={(e) => setDraft((d) => ({ ...d, seats: e.target.value }))} inputMode="numeric" style={input} />
        </Field>
        <Field label="Site">
          <select value={draft.siteId} onChange={(e) => setDraft((d) => ({ ...d, siteId: e.target.value }))} style={input}>
            <option value="">Pick a site</option>
            {SITES.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
      </Row>

      <Field label="Event or function">
        <input
          value={draft.functionName}
          onChange={(e) => setDraft((d) => ({ ...d, functionName: e.target.value }))}
          placeholder="e.g. Brightwater Friday Live"
          style={input}
        />
      </Field>

      <Field label="Date" hint={TZ_LABEL}>
        <input type="date" value={draft.date} onChange={(e) => setTime({ date: e.target.value })} style={input} />
      </Field>

      <Row>
        <Field label="Starts">
          <input type="time" value={draft.startTime} onChange={(e) => setTime({ startTime: e.target.value })} style={input} />
        </Field>
        <Field label="Ends" hint="past midnight is fine">
          <input type="time" value={draft.endTime} onChange={(e) => setTime({ endTime: e.target.value })} style={input} />
        </Field>
      </Row>

      <Row>
        <Field label="Classification" hint={hint ? `${draft.role} is usually ${hint === "introductory" ? "Introductory" : `Level ${hint}`}` : undefined}>
          {/* A picker, never derived. What somebody actually does decides their
              level, and a wrong guess underpays them. */}
          <select value={draft.level} onChange={(e) => setDraft((d) => ({ ...d, level: e.target.value }))} style={input}>
            <option value="">Pick a level</option>
            {LEVELS.map((l) => (
              <option key={String(l)} value={String(l)}>
                {l === "introductory" ? "Introductory" : `Level ${l}`}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Employment">
          <select
            value={draft.employment}
            onChange={(e) => setDraft((d) => ({ ...d, employment: e.target.value as EmploymentType }))}
            style={input}
          >
            <option value="casual">Casual</option>
            <option value="part_time">Part time</option>
            <option value="full_time">Full time</option>
          </select>
        </Field>
      </Row>

      <Row>
        <Field label="Rate" hint="dollars per hour">
          <input value={draft.rate} onChange={(e) => setDraft((d) => ({ ...d, rate: e.target.value }))} inputMode="decimal" placeholder="41.50" style={input} />
        </Field>
        <Field label="Unpaid break" hint="minutes">
          <input value={draft.unpaidBreakMin} onChange={(e) => setDraft((d) => ({ ...d, unpaidBreakMin: e.target.value }))} inputMode="numeric" placeholder="30" style={input} />
        </Field>
      </Row>

      {draft.role && (
        <Field label="What it involves" hint="decides which credentials it is gated on">
          <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
            {(ROLE_FUNCTIONS[draft.role] ?? []).map((fn) => {
              const on = draft.duties.includes(fn);
              return (
                <button
                  key={fn}
                  onClick={() => toggleDuty(fn)}
                  style={{
                    borderRadius: 999, padding: "7px 12px", fontSize: 12.5, fontWeight: 600, cursor: "pointer",
                    border: `1px solid ${on ? "var(--accent, var(--fg-1))" : "var(--border-2)"}`,
                    background: on ? "var(--accent, var(--fg-1))" : "#fff",
                    color: on ? "#fff" : "var(--fg-3)",
                  }}
                >
                  {DUTY_LABEL[fn] ?? fn}
                </button>
              );
            })}
          </div>
        </Field>
      )}

      <RatePanel rate={rate} />

      <label style={{ display: "flex", alignItems: "center", gap: 9, margin: "4px 0 14px", fontSize: 13.5 }}>
        <input
          type="checkbox"
          checked={draft.publish}
          onChange={(e) => setDraft((d) => ({ ...d, publish: e.target.checked }))}
          style={{ width: 18, height: 18 }}
        />
        Put it on the board now
        <span style={{ color: "var(--fg-4)", fontSize: 12 }}>{draft.publish ? "" : "· saves as a draft"}</span>
      </label>

      <button
        onClick={() => void submit()}
        disabled={sending}
        style={{ ...primaryBtn, opacity: sending ? 0.7 : 1, cursor: sending ? "default" : "pointer" }}
      >
        {sending ? "Posting…" : draft.publish ? "Post it" : "Save draft"}
      </button>
    </div>
  );
}

/* ---------- the rate panel ---------- */

type RateState =
  | { state: "incomplete"; errors: string[] }
  | { state: "unset" }
  | { state: "priced"; summary: ReturnType<typeof describePayFor>; blocked: string | null };

/**
 * What the award says about the rate as it is typed.
 *
 * Refusals are shown before the shift is posted rather than after, because the
 * rate is the field a manager has to go and negotiate — being told at submit
 * time that it is $3.62 short is being told once the conversation is over.
 */
function RatePanel({ rate }: { rate: RateState }) {
  if (rate.state === "unset") {
    return (
      <p style={{ margin: "0 0 14px", fontSize: 12.5, color: "var(--fg-4)", lineHeight: 1.5 }}>
        No rate yet. A shift can be posted without one — it goes up saying the rate is not published.
      </p>
    );
  }

  if (rate.state === "incomplete") {
    return (
      <div style={{ background: "var(--warning-bg)", color: "var(--warning-fg)", borderRadius: 12, padding: "11px 13px", marginBottom: 14, fontSize: 12.5, lineHeight: 1.5 }}>
        {rate.errors.map((e) => <div key={e}>{e}</div>)}
      </div>
    );
  }

  const s = rate.summary;
  return (
    <section style={{ background: "var(--fs-navy, #0a1a28)", color: "#fff", borderRadius: 14, padding: "14px 15px", margin: "0 0 14px" }}>
      {/* globals.css colours h3 and p with --fg-1 / --fg-2, which are invisible
          on this panel, so every element states its own colour. */}
      <h3 style={{ margin: 0, fontSize: 10.5, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "#fff", opacity: 0.65 }}>
        What the award says
      </h3>

      {s && (
        <>
          <p style={{ margin: "6px 0 0", display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", color: "#fff" }}>
            <span className="fs-tnum" style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-.02em" }}>
              {fmtAud(s.estGrossCents)}
            </span>
            <span style={{ fontSize: 12.5, opacity: 0.7 }}>
              est. gross · {s.paidHours}h at {fmtAud(s.offeredHourlyCents)}/h
            </span>
          </p>

          <ul style={{ margin: "10px 0 0", padding: 0, listStyle: "none", fontSize: 12.5, color: "#fff" }}>
            {s.bands.map((b) => (
              <li key={b.band} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "3px 0" }}>
                <span style={{ opacity: 0.75 }}>{b.label} · {b.hours}h</span>
                <span className="fs-tnum" style={{ fontWeight: 600, whiteSpace: "nowrap" }}>floor {fmtAud(b.hourlyCents)}/h</span>
              </li>
            ))}
          </ul>
        </>
      )}

      <p
        style={{
          margin: "12px 0 0", padding: "9px 10px", borderRadius: 9, fontSize: 12.5, lineHeight: 1.5, fontWeight: 600,
          background: rate.blocked ? "rgba(255,120,120,.16)" : "rgba(18,217,198,.14)",
          color: rate.blocked ? "#ffb4b4" : "var(--fs-teal-bright, #12d9c6)",
        }}
      >
        {rate.blocked ?? (s ? s.summary : "Above the award floor.")}
      </p>
    </section>
  );
}

/* ---------- form furniture ---------- */

const DUTY_LABEL: Record<string, string> = {
  serve_alcohol: "Serve alcohol",
  handle_food: "Handle food",
  gaming: "Gaming",
  supervise: "Supervise",
};

const input: React.CSSProperties = {
  width: "100%", minHeight: 46, padding: "10px 12px", borderRadius: 10, fontSize: 15,
  border: "1px solid var(--border-2)", background: "#fff", color: "var(--fg-1)",
  // 15px or larger: iOS Safari zooms the whole page on focus below 16px, and a
  // form that jumps when you tap it is a form people stop filling in
  boxSizing: "border-box",
};

const primaryBtn: React.CSSProperties = {
  display: "block", width: "100%", minHeight: 50, borderRadius: 12, fontSize: 15, fontWeight: 700,
  border: "1px solid var(--accent, var(--fg-1))", background: "var(--accent, var(--fg-1))", color: "#fff",
  cursor: "pointer",
};

const secondaryLink: React.CSSProperties = {
  display: "block", width: "100%", minHeight: 46, lineHeight: "46px", textAlign: "center",
  borderRadius: 12, fontSize: 14.5, fontWeight: 600, textDecoration: "none",
  border: "1px solid var(--border-2)", background: "#fff", color: "var(--fg-2)",
};

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--fg-3)", marginBottom: 5 }}>
        {label}
        {hint && <span style={{ fontWeight: 400, color: "var(--fg-4)" }}> · {hint}</span>}
      </label>
      {children}
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>{children}</div>;
}
