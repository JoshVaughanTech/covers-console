"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  HIGA,
  assessAll,
  fmtClock,
  fmtDuration,
  type BreakAssessment,
  type BreakKind,
  type ShiftSession,
  type Severity,
} from "@/lib/awards";
import { WORKERS } from "@/lib/idara/seed";
import { currentSupervisor, setSupervisor, clearSupervisor, type Supervisor } from "@/lib/mobile/identity";

/* ============================================================
   Break Compliance, on the floor.

   Same award engine as the console — assess() is pure and runs here
   too, so the phone and the dashboard cannot disagree about who is
   overdue. What differs is everything around it: one column, sorted
   by urgency, thumb-sized targets, and a single action per person.

   Decisions go to POST /api/breaks/decision, which owns the whole
   two-phase write. The phone does not chain anything itself; the
   server holds the lock that decides order.
   ============================================================ */

const TZ = "Australia/Melbourne";

const SEV: Record<Severity, { label: string; bg: string; fg: string; border: string }> = {
  3: { label: "Overdue", bg: "var(--danger-bg)", fg: "var(--danger-fg)", border: "var(--danger)" },
  2: { label: "Due", bg: "var(--warning-bg)", fg: "var(--warning-fg)", border: "var(--warning)" },
  1: { label: "Note", bg: "var(--info-bg)", fg: "var(--info-fg)", border: "var(--info)" },
  0: { label: "Clear", bg: "var(--success-bg)", fg: "var(--success-fg)", border: "var(--success)" },
};

interface Payload {
  mode: "demo" | "live" | "error";
  sessions: ShiftSession[];
}

/** A decision this device has sent, and what became of it. */
interface Sent {
  userId: string;
  state: "sending" | "ok" | "queued" | "failed";
  reason?: string;
}

export default function MobileBreaksPage() {
  const [me, setMe] = useState<Supervisor | null>(null);
  const [ready, setReady] = useState(false);
  const [payload, setPayload] = useState<Payload | null>(null);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [open, setOpen] = useState<string | null>(null);
  const [sent, setSent] = useState<Record<string, Sent>>({});

  /* identity is read after mount: localStorage does not exist on the server,
     and reading it during render would be a hydration mismatch */
  useEffect(() => {
    setMe(currentSupervisor());
    setReady(true);
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/breaks");
      setPayload((await res.json()) as Payload);
    } catch {
      setPayload({ mode: "error", sessions: [] });
    }
  }, []);

  useEffect(() => {
    if (!me) return;
    void load();
    const t = setInterval(() => void load(), 30_000);
    return () => clearInterval(t);
  }, [me, load]);

  /* Another device sending someone on a break should be visible here without
     waiting for the next poll — that is the whole point of one shared chain. */
  useEffect(() => {
    if (!me) return;
    const es = new EventSource("/api/events/stream");
    es.onmessage = () => void load();
    return () => es.close();
  }, [me, load]);

  const staff = useMemo(
    () => (payload ? assessAll(payload.sessions, now, { timezone: TZ }) : []),
    [payload, now],
  );

  const queue = staff.filter((p) => p.severity >= 2 && !p.onBreak);
  const rest = staff.filter((p) => !(p.severity >= 2 && !p.onBreak));

  async function send(p: BreakAssessment, kind: BreakKind) {
    if (!me) return;
    setSent((s) => ({ ...s, [p.userId]: { userId: p.userId, state: "sending" } }));
    setOpen(null);
    try {
      const res = await fetch("/api/breaks/decision", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          subject: `did:web:idara.app:${p.userId}`,
          name: p.name,
          kind,
          at: new Date().toISOString(),
          actor: me.name,
          overdue: p.severity === 3,
          // survives a retry: the same decision must not send twice
          clientRef: `${p.userId}-${Math.floor(Date.now() / 1000)}`,
          data: {
            award: HIGA.awardId,
            role: p.role,
            siteName: p.siteName,
            // AuditEvent.actor is a display string, so the identifier rides
            // alongside it. Two supervisors can share a name; a DID is the
            // only thing that says which one, and the chain is append-only —
            // an ambiguous actor stays ambiguous forever.
            actorDid: me.did,
            via: "mobile",
          },
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { pushed: string };
      setSent((s) => ({
        ...s,
        // "skipped" means recorded here but not written to the timesheet —
        // shown as queued rather than done, so nobody assumes payroll saw it
        [p.userId]: { userId: p.userId, state: body.pushed === "ok" ? "ok" : "queued" },
      }));
      void load();
    } catch (e) {
      setSent((s) => ({
        ...s,
        [p.userId]: { userId: p.userId, state: "failed", reason: e instanceof Error ? e.message : "failed" },
      }));
    }
  }

  if (!ready) return null;
  if (!me) return <SignIn onPick={(s) => { setSupervisor(s); setMe(s); }} />;

  const active = open ? staff.find((p) => p.userId === open) ?? null : null;

  return (
    <div style={{ padding: "14px 14px 28px" }}>
      <header style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 14 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ margin: 0, fontSize: 21, letterSpacing: "-.02em" }}>Breaks</h1>
          <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--fg-4)" }}>
            {HIGA.awardId} cl 16 · {fmtClock(now, TZ)}
          </p>
        </div>
        <button
          onClick={() => { clearSupervisor(); setMe(null); }}
          style={{
            border: "1px solid var(--border-2)", background: "#fff", borderRadius: 999,
            padding: "6px 12px", fontSize: 12, fontWeight: 600, color: "var(--fg-2)", cursor: "pointer",
          }}
        >
          {me.name.split(" ")[0]}
        </button>
      </header>

      {payload?.mode === "error" && (
        <Banner tone="danger">Time-clock data unavailable — this list may be out of date.</Banner>
      )}

      {queue.length === 0 && staff.length > 0 && (
        <Banner tone="success">Nobody is due or overdue. {staff.length} on shift.</Banner>
      )}

      {!payload && <p style={{ fontSize: 13, color: "var(--fg-4)" }}>Loading the floor…</p>}

      {queue.length > 0 && (
        <Section title={`Needs a break (${queue.length})`}>
          {queue.map((p) => (
            <PersonRow key={p.userId} p={p} now={now} sent={sent[p.userId]} onTap={() => setOpen(p.userId)} />
          ))}
        </Section>
      )}

      {rest.length > 0 && (
        <Section title={`Everyone else (${rest.length})`}>
          {rest.map((p) => (
            <PersonRow key={p.userId} p={p} now={now} sent={sent[p.userId]} onTap={() => setOpen(p.userId)} />
          ))}
        </Section>
      )}

      {active && <Sheet p={active} now={now} me={me} onClose={() => setOpen(null)} onSend={send} />}
    </div>
  );
}

/* ---------- sign in ---------- */

function SignIn({ onPick }: { onPick: (s: Supervisor) => void }) {
  return (
    <div style={{ padding: "28px 18px" }}>
      <h1 style={{ margin: "0 0 4px", fontSize: 23, letterSpacing: "-.02em" }}>Who are you?</h1>
      <p style={{ margin: "0 0 20px", fontSize: 13.5, color: "var(--fg-4)", lineHeight: 1.55 }}>
        Every break you send is recorded against your name in the audit log. This device will
        remember you.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {WORKERS.map((w) => (
          <button
            key={w.did}
            onClick={() => onPick({ did: w.did, name: w.name, role: w.role })}
            style={{
              display: "flex", alignItems: "center", gap: 12, width: "100%", textAlign: "left",
              // 56px: a thumb target, not a cursor target
              minHeight: 56, padding: "10px 14px", borderRadius: 12,
              border: "1px solid var(--border)", background: "#fff", cursor: "pointer",
            }}
          >
            <span
              style={{
                width: 36, height: 36, borderRadius: 999, background: "var(--bg-2)",
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                fontSize: 12.5, fontWeight: 700, color: "var(--fg-3)", flexShrink: 0,
              }}
            >
              {w.name.split(" ").map((x) => x[0]).join("")}
            </span>
            <span style={{ minWidth: 0 }}>
              <span style={{ display: "block", fontSize: 15, fontWeight: 600, color: "var(--fg-1)" }}>{w.name}</span>
              <span style={{ display: "block", fontSize: 12, color: "var(--fg-4)" }}>{w.role}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ---------- pieces ---------- */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 18 }}>
      <h2 style={{ margin: "0 0 8px", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", color: "var(--fg-4)" }}>
        {title}
      </h2>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{children}</div>
    </section>
  );
}

function Banner({ tone, children }: { tone: "danger" | "success"; children: React.ReactNode }) {
  const c = tone === "danger"
    ? { bg: "var(--danger-bg)", fg: "var(--danger-fg)", border: "var(--danger)" }
    : { bg: "var(--success-bg)", fg: "var(--success-fg)", border: "var(--success)" };
  return (
    <div style={{ background: c.bg, color: c.fg, border: `1px solid ${c.border}`, borderRadius: 10, padding: "10px 12px", fontSize: 12.5, marginBottom: 14, lineHeight: 1.5 }}>
      {children}
    </div>
  );
}

function PersonRow({
  p, now, sent, onTap,
}: { p: BreakAssessment; now: number; sent?: Sent; onTap: () => void }) {
  const sev = SEV[p.severity];
  const elapsed = p.onShift ? now - p.clockIn : p.elapsedSec;
  return (
    <button
      onClick={onTap}
      style={{
        display: "flex", alignItems: "center", gap: 12, width: "100%", textAlign: "left",
        minHeight: 64, padding: "10px 12px", borderRadius: 12, cursor: "pointer",
        background: "#fff", border: `1px solid ${p.onBreak ? "var(--info)" : sev.border}`,
      }}
    >
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 15, fontWeight: 600, color: "var(--fg-1)" }}>{p.name}</span>
        <span style={{ display: "block", fontSize: 11.5, color: "var(--fg-4)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {p.role} · {p.siteName}
        </span>
      </span>
      <span style={{ textAlign: "right", flexShrink: 0 }}>
        <span className="fs-tnum" style={{ display: "block", fontSize: 15, fontWeight: 700, color: "var(--fg-1)" }}>
          {fmtDuration(elapsed)}
        </span>
        <span
          style={{
            display: "inline-block", marginTop: 3, padding: "2px 8px", borderRadius: 999,
            fontSize: 10.5, fontWeight: 700,
            background: p.onBreak ? "var(--info-bg)" : sev.bg,
            color: p.onBreak ? "var(--info-fg)" : sev.fg,
          }}
        >
          {sent?.state === "sending" ? "Sending…"
            : sent?.state === "queued" ? "Recorded"
            : sent?.state === "failed" ? "Failed"
            : p.onBreak ? `On ${p.onBreak.kind}`
            : sev.label}
        </span>
      </span>
    </button>
  );
}

function Sheet({
  p, now, me, onClose, onSend,
}: {
  p: BreakAssessment; now: number; me: Supervisor;
  onClose: () => void; onSend: (p: BreakAssessment, k: BreakKind) => void;
}) {
  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(12,20,32,.45)", display: "flex", alignItems: "flex-end", zIndex: 50 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff", width: "100%", borderRadius: "16px 16px 0 0",
          padding: "18px 16px calc(18px + env(safe-area-inset-bottom))",
          maxHeight: "86dvh", overflowY: "auto",
        }}
      >
        <div style={{ width: 36, height: 4, borderRadius: 999, background: "var(--border-2)", margin: "0 auto 14px" }} />

        <h3 style={{ margin: "0 0 2px", fontSize: 19 }}>{p.name}</h3>
        <p style={{ margin: "0 0 14px", fontSize: 12.5, color: "var(--fg-4)" }}>
          {p.role} · {p.siteName} · on shift {fmtDuration(p.onShift ? now - p.clockIn : p.elapsedSec)}
        </p>

        <p style={{ margin: "0 0 14px", fontSize: 13.5, lineHeight: 1.55, color: p.severity === 3 ? "var(--danger-fg)" : "var(--fg-2)", fontWeight: p.severity === 3 ? 600 : 400 }}>
          {p.nextAction}
        </p>

        {p.penalty?.accruing && (
          <Banner tone="danger">
            cl 16.6 loading accruing since {fmtClock(p.penalty.from, TZ)} — {fmtDuration(p.penalty.seconds)}
            {p.penalty.estimateAud != null ? ` · $${p.penalty.estimateAud.toFixed(2)}` : ""}
          </Banner>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>
          <BigButton primary onClick={() => onSend(p, "meal")}>Send on meal break</BigButton>
          <BigButton onClick={() => onSend(p, "rest")}>Send on rest break</BigButton>
        </div>

        <p style={{ margin: "12px 0 0", fontSize: 11.5, color: "var(--fg-4)", lineHeight: 1.5 }}>
          Recorded against <strong>{me.name}</strong> in the audit log.
        </p>
      </div>
    </div>
  );
}

function BigButton({
  children, onClick, primary,
}: { children: React.ReactNode; onClick: () => void; primary?: boolean }) {
  return (
    <button
      onClick={onClick}
      style={{
        // full width, 52px tall: usable one-handed, mid-service
        width: "100%", minHeight: 52, borderRadius: 12, cursor: "pointer",
        fontSize: 15.5, fontWeight: 700,
        background: primary ? "var(--fs-teal)" : "#fff",
        color: primary ? "#fff" : "var(--fg-1)",
        border: primary ? "1px solid transparent" : "1px solid var(--border-2)",
      }}
    >
      {children}
    </button>
  );
}
