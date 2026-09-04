"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { WORKERS } from "@/lib/idara/seed";
import { currentPerson, setPerson, clearPerson, type Person } from "@/lib/mobile/identity";

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
  const [me, setMe] = useState<Person | null>(null);
  const [ready, setReady] = useState(false);
  const [payload, setPayload] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [sent, setSent] = useState<Record<string, Sent>>({});

  /* identity is read after mount: localStorage does not exist on the server,
     and reading it during render would be a hydration mismatch */
  useEffect(() => {
    setMe(currentPerson());
    setReady(true);
  }, []);

  const load = useCallback(async (did: string) => {
    try {
      const res = await fetch(`/api/shifts?did=${encodeURIComponent(did)}`);
      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
      setPayload(await res.json());
      setError(null);
    } catch (e) {
      // a board that fails to load must say so; a silent empty list reads as
      // "no work going", which is a different and wrong answer
      setError(e instanceof Error ? e.message : "Could not load shifts");
    }
  }, []);

  useEffect(() => {
    if (me) void load(me.did);
  }, [me, load]);

  const groups = useMemo(() => {
    const all = payload?.shifts ?? [];
    return {
      // rostered, not "standing assigned": a manager can put someone on a
      // shift they never claimed, and that person is just as on it
      yours: all.filter((s) => s.rostered),
      waiting: all.filter((s) => !s.rostered && s.standing?.standing === "open"),
      available: all.filter((s) => s.claimable),
      blocked: all.filter((s) => s.blockReason && !s.rostered),
    };
  }, [payload]);

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
        body: JSON.stringify({ did: me.did, postingId: s.id, clientRef }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setSent((x) => ({ ...x, [s.id]: { state: "ok" } }));
      setOpen(null);
      await load(me.did);
    } catch (e) {
      setSent((x) => ({
        ...x,
        [s.id]: { state: "failed", reason: e instanceof Error ? e.message : "failed" },
      }));
    }
  }

  if (!ready) return null;
  if (!me) return <SignIn onPick={(p) => { setPerson(p); setMe(p); }} />;

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
          onClick={() => { clearPerson(); setMe(null); setPayload(null); }}
          style={{
            border: "1px solid var(--border-2)", background: "#fff", borderRadius: 999,
            padding: "6px 12px", fontSize: 12, fontWeight: 600, color: "var(--fg-2)", cursor: "pointer",
          }}
        >
          {me.name.split(" ")[0]}
        </button>
      </header>

      <nav style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <Link href="/m" style={tabStyle(false)}>Breaks</Link>
        <span style={tabStyle(true)}>Shifts</span>
      </nav>

      {error && <Banner tone="danger">{error}</Banner>}

      {!payload && !error && <p style={{ fontSize: 13, color: "var(--fg-4)" }}>Loading the board…</p>}

      {payload && groups.available.length === 0 && groups.waiting.length === 0 && groups.yours.length === 0 && (
        <Banner tone="info">
          {groups.blocked.length > 0
            ? `Nothing you can take right now. ${groups.blocked.length} shift${groups.blocked.length === 1 ? "" : "s"} below need something you don't hold yet.`
            : "No open shifts at the moment."}
        </Banner>
      )}

      {groups.yours.length > 0 && (
        <Section title={`You're on (${groups.yours.length})`}>
          {groups.yours.map((s) => <Row key={s.id} s={s} onTap={() => setOpen(s.id)} />)}
        </Section>
      )}

      {groups.waiting.length > 0 && (
        <Section title={`Waiting on the manager (${groups.waiting.length})`}>
          {groups.waiting.map((s) => <Row key={s.id} s={s} onTap={() => setOpen(s.id)} />)}
        </Section>
      )}

      {groups.available.length > 0 && (
        <Section title={`Available to you (${groups.available.length})`}>
          {groups.available.map((s) => (
            <Row key={s.id} s={s} sent={sent[s.id]} onTap={() => setOpen(s.id)} />
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

/* ---------- sign in ---------- */

function SignIn({ onPick }: { onPick: (p: Person) => void }) {
  return (
    <div style={{ padding: "28px 18px" }}>
      <h1 style={{ margin: "0 0 4px", fontSize: 23, letterSpacing: "-.02em" }}>Who are you?</h1>
      <p style={{ margin: "0 0 20px", fontSize: 13.5, color: "var(--fg-4)", lineHeight: 1.55 }}>
        Shifts are offered against your credentials, and every claim is recorded against your
        name. This device will remember you.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {WORKERS.map((w) => (
          <button
            key={w.did}
            onClick={() => onPick({ did: w.did, name: w.name, role: w.role })}
            style={{
              display: "flex", alignItems: "center", gap: 12, width: "100%", textAlign: "left",
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

const tabStyle = (on: boolean): React.CSSProperties => ({
  flex: 1, textAlign: "center", padding: "8px 0", borderRadius: 10, fontSize: 13, fontWeight: 600,
  textDecoration: "none",
  border: `1px solid ${on ? "var(--accent)" : "var(--border)"}`,
  background: on ? "var(--accent-bg, var(--bg-2))" : "#fff",
  color: on ? "var(--accent-fg, var(--fg-1))" : "var(--fg-3)",
});

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

function Row({ s, sent, onTap }: { s: Shift; sent?: Sent; onTap: () => void }) {
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
        <span style={{ fontSize: 15, fontWeight: 600, color: "var(--fg-1)" }}>{s.role}</span>
        <span style={{ fontSize: 12, color: "var(--fg-4)", whiteSpace: "nowrap" }}>{s.day}</span>
      </span>
      <span style={{ display: "block", fontSize: 12.5, color: "var(--fg-3)", marginTop: 2 }}>
        {s.functionName} · {s.window}
      </span>
      <span style={{ display: "block", fontSize: 12, color: "var(--fg-4)", marginTop: 2 }}>
        {s.siteName}
        {s.seatsLeft > 0 && ` · ${s.seatsLeft} of ${s.seats} left`}
      </span>

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
