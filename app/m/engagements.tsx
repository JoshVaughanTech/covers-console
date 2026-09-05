"use client";

import { useCallback, useEffect, useState } from "react";

/* ============================================================
   The tap that is the signature.

   Everything on the sheet is there because somebody signing an
   employment agreement is entitled to see it before they sign, and
   because this product's claim is that the paperwork disappeared —
   not that it happened somewhere they could not read it. So the
   sheet states, in this order: who is employing them and under what
   ABN, what the shift is, what it pays and what the award floor for
   it was, how tax will be withheld and why, and exactly which parts
   of their pack are about to leave it and which payroll receives
   them.

   The release list is computed by the same function that does the
   releasing (plannedReleases, via /api/engagements). A consent
   screen assembling its own version of "what we will send" is a
   consent screen that eventually describes something else.

   A second engagement with the same venue releases nothing, and the
   sheet says so. That is the argument for employing once rather
   than per booking, made where it is felt.
   ============================================================ */

interface Release {
  item: string;
  label: string;
  toConnector?: string;
  at?: string;
}

export interface Engagement {
  id: string;
  status: string;
  standing: "sign" | "signed" | "ready" | "done" | "cancelled";
  role: string;
  siteName: string;
  date: string;
  window: string;
  employer: { did: string; name: string; abn: string; signatory: string };
  host: { did: string; name: string } | null;
  pay: {
    offeredHourlyCents: number;
    floorHourlyCents: number;
    marginHourlyCents: number;
    level: string | number;
    stream: string;
    loadings: string[];
    superRate: number;
    hours: number;
    estGrossCents: number;
    estSuperCents: number;
  };
  employment: { first: boolean; claimsTaxFreeThreshold: boolean; agreementTemplateVersion: string };
  willRelease: Release[];
  releases: Release[];
  acceptance: {
    worker: { at: string; eventHash: string } | null;
    employer: { at: string; eventHash: string } | null;
  };
  thresholdNotice: string | null;
  blockedBy: string | null;
}

const aud = (cents: number) => {
  const sign = cents < 0 ? "-" : "";
  const a = Math.abs(cents);
  return `${sign}$${Math.floor(a / 100)}.${String(a % 100).padStart(2, "0")}`;
};

const LOADING_LABEL: Record<string, string> = {
  casual_25: "Casual loading 25%",
  saturday: "Saturday",
  sunday: "Sunday",
  public_holiday: "Public holiday",
  evening: "Weekday evening",
  night: "Weekday night",
};

const CONNECTOR_LABEL: Record<string, string> = {
  mock: "the demo payroll",
  xero: "Xero Payroll",
  keypay: "KeyPay",
  employment_hero: "Employment Hero",
  myob: "MYOB",
  connecteam_payroll: "Connecteam Payroll",
};

const dateLabel = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });

interface Sent {
  state: "sending" | "ok" | "failed";
  reason?: string;
  released?: string[];
}

/**
 * The engagements section. Renders nothing at all when there are none, so it
 * can sit unconditionally at the top of My shifts without leaving a heading
 * over an empty box.
 */
export function Engagements({ onChanged }: { onChanged?: () => void }) {
  const [list, setList] = useState<Engagement[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [sent, setSent] = useState<Record<string, Sent>>({});

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/engagements");
      if (!res.ok) return;
      const body = (await res.json()) as { engagements: Engagement[] };
      setList(body.engagements);
    } catch {
      /* the rest of the screen still works; an employment offer that failed to
         load is better absent than half-rendered */
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function accept(e: Engagement) {
    setSent((s) => ({ ...s, [e.id]: { state: "sending" } }));
    try {
      const res = await fetch("/api/engagements/accept", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // one ref per tap, so a retry of THIS tap is not a second signature
        body: JSON.stringify({ engagementId: e.id, clientRef: `${e.id}:${Date.now()}` }),
      });
      const body = await res.json();
      if (!res.ok && !body.accepted) throw new Error(body.error ?? `HTTP ${res.status}`);
      setSent((s) => ({
        ...s,
        [e.id]: {
          state: "ok",
          released: (body.released as string[] | undefined) ?? [],
          // a signature that landed while payroll did not answer is still a
          // signature, and saying so is the honest reading of a 502 here
          ...(body.provisioned === false ? { reason: body.error as string } : {}),
        },
      }));
      setOpen(null);
      await load();
      onChanged?.();
    } catch (err) {
      setSent((s) => ({
        ...s,
        [e.id]: { state: "failed", reason: err instanceof Error ? err.message : "Could not sign" },
      }));
    }
  }

  if (!list || list.length === 0) return null;

  const toSign = list.filter((e) => e.standing === "sign");
  const live = list.filter((e) => e.standing === "signed" || e.standing === "ready");
  const active = open ? list.find((e) => e.id === open) ?? null : null;

  return (
    <section style={{ marginBottom: 18 }}>
      {toSign.length > 0 && (
        <>
          <h2 style={heading}>
            {toSign.length === 1 ? "One shift needs your signature" : `${toSign.length} shifts need your signature`}
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
            {toSign.map((e) => (
              <Row key={e.id} e={e} sent={sent[e.id]} onTap={() => setOpen(e.id)} />
            ))}
          </div>
        </>
      )}

      {live.length > 0 && (
        <>
          <h2 style={heading}>Employed for</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {live.map((e) => (
              <Signed key={e.id} e={e} sent={sent[e.id]} />
            ))}
          </div>
        </>
      )}

      {active && (
        <Sheet
          e={active}
          sent={sent[active.id]}
          onClose={() => setOpen(null)}
          onAccept={() => accept(active)}
        />
      )}
    </section>
  );
}

/* ---------- pieces ---------- */

const heading: React.CSSProperties = {
  margin: "0 0 8px",
  fontSize: 11.5,
  fontWeight: 700,
  letterSpacing: ".06em",
  textTransform: "uppercase",
  color: "var(--fg-4)",
};

function Row({ e, sent, onTap }: { e: Engagement; sent?: Sent; onTap: () => void }) {
  return (
    <button
      onClick={onTap}
      style={{
        display: "block", width: "100%", textAlign: "left", minHeight: 56,
        padding: "12px 13px", borderRadius: 12, cursor: "pointer",
        border: "1px solid var(--accent, var(--fg-1))", background: "#fff",
      }}
    >
      <span style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: "var(--fg-1)" }}>{e.role}</span>
        <span className="fs-tnum" style={{ fontSize: 15, fontWeight: 700, whiteSpace: "nowrap" }}>
          {aud(e.pay.offeredHourlyCents)}
          <span style={{ fontSize: 11, fontWeight: 500, color: "var(--fg-4)" }}>/h</span>
        </span>
      </span>
      <span style={{ display: "block", fontSize: 12.5, color: "var(--fg-3)", marginTop: 2 }}>
        {e.employer.name} · {dateLabel(e.date)} · {e.window}
      </span>
      <span style={{ display: "block", fontSize: 12, color: "var(--fg-4)", marginTop: 2 }}>
        {e.siteName}
      </span>
      <span
        style={{
          display: "inline-block", marginTop: 8, fontSize: 12, fontWeight: 700,
          color: "var(--accent-fg, #fff)", background: "var(--accent, var(--fg-1))",
          borderRadius: 999, padding: "5px 11px",
        }}
      >
        {e.employment.first ? "Review and sign — first shift here" : "Review and sign"}
      </span>
      {sent?.state === "failed" && (
        <span style={{ display: "block", marginTop: 7, fontSize: 12, color: "var(--danger-fg)" }}>
          {sent.reason}
        </span>
      )}
    </button>
  );
}

function Signed({ e, sent }: { e: Engagement; sent?: Sent }) {
  const provisioned = e.status === "provisioned" || e.status === "worked" || e.status === "confirmed";
  return (
    <div
      style={{
        padding: "12px 13px", borderRadius: 12,
        border: "1px solid var(--border-2)", background: "#fff",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
        <strong style={{ fontSize: 15, color: "var(--fg-1)" }}>{e.role}</strong>
        <span className="fs-tnum" style={{ fontSize: 14, fontWeight: 700, whiteSpace: "nowrap" }}>
          {aud(e.pay.offeredHourlyCents)}
          <span style={{ fontSize: 11, fontWeight: 500, color: "var(--fg-4)" }}>/h</span>
        </span>
      </div>
      <div style={{ fontSize: 12.5, color: "var(--fg-3)", marginTop: 2 }}>
        {e.employer.name} · {dateLabel(e.date)} · {e.window}
      </div>
      <span
        style={{
          display: "inline-block", marginTop: 8, fontSize: 11.5, fontWeight: 600,
          color: provisioned ? "var(--success-fg)" : "var(--info-fg)",
          background: provisioned ? "var(--success-bg)" : "var(--info-bg)",
          borderRadius: 999, padding: "4px 9px",
        }}
      >
        {provisioned
          ? e.employment.first
            ? "Signed — you're on their payroll"
            : "Signed — already on their payroll"
          : "Signed — waiting on payroll"}
      </span>
      {sent?.reason && (
        <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--warning-fg)" }}>{sent.reason}</p>
      )}
      {e.releases.length > 0 && (
        <p style={{ margin: "8px 0 0", fontSize: 11.5, color: "var(--fg-4)", lineHeight: 1.5 }}>
          Released to {CONNECTOR_LABEL[e.releases[0].toConnector ?? ""] ?? e.releases[0].toConnector}:{" "}
          {e.releases.map((r) => r.label).join(", ")}.
        </p>
      )}
    </div>
  );
}

/**
 * The agreement, in full, on a phone.
 *
 * Long on purpose. The one thing that would make "a shift is a signature"
 * indefensible is a sheet that hid what was being signed behind a friendly
 * summary — so the terms are here, the money is broken out against the award
 * floor that constrained it, and the disclosure is itemised.
 */
function Sheet({
  e, sent, onClose, onAccept,
}: {
  e: Engagement;
  sent?: Sent;
  onClose: () => void;
  onAccept: () => void;
}) {
  const busy = sent?.state === "sending";
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,.34)",
        display: "flex", alignItems: "flex-end", zIndex: 40,
      }}
    >
      <div
        onClick={(ev) => ev.stopPropagation()}
        style={{
          width: "100%", background: "var(--bg)", borderRadius: "16px 16px 0 0",
          padding: "18px 16px calc(18px + env(safe-area-inset-bottom))",
          maxHeight: "88dvh", overflowY: "auto",
        }}
      >
        <h2 style={{ margin: "0 0 2px", fontSize: 19, letterSpacing: "-.02em" }}>
          {e.role} · {dateLabel(e.date)}
        </h2>
        <p style={{ margin: "0 0 14px", fontSize: 13, color: "var(--fg-4)" }}>
          {e.siteName} · {e.window}
        </p>

        <Block title="Who employs you">
          <p style={line}>
            <strong>{e.employer.name}</strong> — ABN {e.employer.abn}
          </p>
          {e.host && (
            <p style={muted}>
              You work at {e.host.name}. {e.employer.name} is your employer of record.
            </p>
          )}
          <p style={muted}>
            Signed for the venue by {e.employer.signatory}. Covers is not your employer and never
            handles your wages.
          </p>
        </Block>

        <section
          style={{
            background: "var(--fs-navy, #0a1a28)", color: "#fff", borderRadius: 14,
            padding: "14px 15px", margin: "0 0 14px",
          }}
        >
          <h3 style={{ margin: 0, fontSize: 10.5, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "#fff", opacity: 0.65 }}>
            What this shift pays
          </h3>
          <p style={{ margin: "6px 0 0", display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", color: "#fff" }}>
            <span className="fs-tnum" style={{ fontSize: 30, fontWeight: 800, letterSpacing: "-.02em" }}>
              {aud(e.pay.estGrossCents)}
            </span>
            <span style={{ fontSize: 12.5, opacity: 0.7 }}>
              est. gross · {e.pay.hours}h at {aud(e.pay.offeredHourlyCents)}/h
            </span>
          </p>
          <ul style={{ margin: "12px 0 0", padding: 0, listStyle: "none", fontSize: 12.5, color: "#fff" }}>
            <li style={payRow}>
              <span style={{ opacity: 0.75 }}>Award floor, dearest hour</span>
              <span className="fs-tnum" style={{ fontWeight: 600 }}>{aud(e.pay.floorHourlyCents)}/h</span>
            </li>
            <li style={payRow}>
              <span style={{ opacity: 0.75 }}>Classification</span>
              <span style={{ fontWeight: 600 }}>Level {String(e.pay.level)}</span>
            </li>
            <li style={payRow}>
              <span style={{ opacity: 0.75 }}>Super at {Math.round(e.pay.superRate * 100)}%</span>
              <span className="fs-tnum" style={{ fontWeight: 600 }}>{aud(e.pay.estSuperCents)}</span>
            </li>
          </ul>
          {e.pay.loadings.length > 0 && (
            <p style={{ margin: "10px 0 0", fontSize: 11.5, color: "#fff", opacity: 0.7 }}>
              Includes {e.pay.loadings.map((l) => LOADING_LABEL[l] ?? l).join(", ")}.
            </p>
          )}
          <p
            style={{
              margin: "12px 0 0", padding: "9px 10px", borderRadius: 9, fontSize: 12.5, lineHeight: 1.5,
              background: "rgba(18,217,198,.14)", color: "var(--fs-teal-bright, #12d9c6)", fontWeight: 600,
            }}
          >
            {e.pay.marginHourlyCents > 0
              ? `✓ ${aud(e.pay.marginHourlyCents)}/h above the award floor for every hour of this shift.`
              : "✓ At the award floor for every hour of this shift."}
          </p>
        </section>

        <Block title="Tax">
          <p style={line}>
            {e.employment.claimsTaxFreeThreshold
              ? "You claim the tax-free threshold with this employer, so they withhold at the lower rate."
              : "This employer withholds at the no-threshold rate."}
          </p>
          {e.thresholdNotice && <p style={muted}>{e.thresholdNotice}</p>}
        </Block>

        <Block title={e.employment.first ? "What leaves your pack" : "Nothing leaves your pack"}>
          {e.willRelease.length > 0 ? (
            <>
              <ul style={{ margin: "0 0 6px", paddingLeft: 18, fontSize: 13.5, lineHeight: 1.6 }}>
                {e.willRelease.map((r) => (
                  <li key={r.item}>{r.label}</li>
                ))}
              </ul>
              <p style={muted}>
                Sent once, to this employer&rsquo;s payroll, to create you as an employee and lodge
                your tax declaration. Nobody at the venue sees these — they go to the payroll
                system, and every release is listed in your pack.
              </p>
            </>
          ) : (
            <p style={muted}>
              You are already on {e.employer.name}&rsquo;s payroll from an earlier shift, so nothing
              is sent again. This just adds you to the roster.
            </p>
          )}
        </Block>

        <Block title="The agreement">
          <p style={muted}>
            Standard casual terms, version {e.employment.agreementTemplateVersion}. You signed these
            once when you built your pack; the venue signed its half in advance. Accepting records
            both signatures against this shift on the audit chain, with your identity and the terms
            above pinned by hash.
          </p>
        </Block>

        {e.blockedBy && (
          <div style={{ background: "var(--warning-bg)", color: "var(--warning-fg)", borderRadius: 10, padding: "10px 12px", fontSize: 13, marginBottom: 12 }}>
            {e.blockedBy} You can&rsquo;t sign until it&rsquo;s complete.
          </div>
        )}
        {sent?.state === "failed" && (
          <div style={{ background: "var(--danger-bg)", color: "var(--danger-fg)", borderRadius: 10, padding: "10px 12px", fontSize: 13, marginBottom: 12 }}>
            {sent.reason}
          </div>
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
          <button
            onClick={onClose}
            style={{
              flex: 1, minHeight: 50, borderRadius: 12, fontSize: 15, fontWeight: 600,
              border: "1px solid var(--border-2)", background: "#fff", color: "var(--fg-2)", cursor: "pointer",
            }}
          >
            Not now
          </button>
          <button
            onClick={onAccept}
            disabled={busy || Boolean(e.blockedBy)}
            style={{
              flex: 2, minHeight: 50, borderRadius: 12, fontSize: 15, fontWeight: 700,
              border: "1px solid var(--accent, var(--fg-1))",
              background: "var(--accent, var(--fg-1))", color: "#fff",
              cursor: busy || e.blockedBy ? "default" : "pointer",
              opacity: busy || e.blockedBy ? 0.6 : 1,
            }}
          >
            {busy ? "Signing…" : "Accept and sign"}
          </button>
        </div>
        <p style={{ margin: "10px 0 0", fontSize: 11, color: "var(--fg-4)", textAlign: "center", lineHeight: 1.5 }}>
          Accepting is your signature on this engagement.
        </p>
      </div>
    </div>
  );
}

const payRow: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 12,
  padding: "3px 0",
};

const line: React.CSSProperties = { margin: "0 0 4px", fontSize: 13.5, lineHeight: 1.5 };
const muted: React.CSSProperties = { margin: 0, fontSize: 12.5, lineHeight: 1.55, color: "var(--fg-3)" };

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      style={{
        border: "1px solid var(--border)", borderRadius: 12, padding: "12px 13px",
        marginBottom: 12, background: "#fff",
      }}
    >
      <h3 style={{ margin: "0 0 6px", fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--fg-4)" }}>
        {title}
      </h3>
      {children}
    </section>
  );
}
