"use client";

import { useCallback, useEffect, useState } from "react";
import { SignIn, type Signed } from "../sign-in";
import { MobileNav } from "../nav";

/* ============================================================
   Your pack.

   The screen that makes "a shift is a signature" true. Everything a
   venue would otherwise put on a form is here, verified once and
   held by the person it is about — and the argument this screen has
   to win is that holding it is safe.

   So it says three things a normal onboarding form never does.

   WHAT IS VERIFIED, AND BY WHOM. Not "complete", which is a claim
   about a form. "Checked by a KYC provider on 4 March" is a claim
   about the world, and it names who to disbelieve.

   WHAT IS LOCKED. Five of the ten items are never shown to a venue
   at all — they leave the pack only inside an engagement, only to
   the payroll that engagement names, and only once. The lock is not
   decoration: the payload is encrypted with a key derived per
   worker, and the only code that decrypts it is provision().

   WHERE IT WENT. Every release, with the venue and the payroll that
   received it. A disclosure log the person disclosed can read is
   the difference between holding somebody's data and holding it on
   their behalf.

   What is missing is stated as what it costs — "you can't accept a
   shift until this is done" — because that is the true consequence,
   and a progress ring on its own is a nag.
   ============================================================ */

type ItemState = "valid" | "expired" | "revoked" | "missing";

interface Item {
  kind: string;
  label: string;
  blurb: string;
  sensitivity: "public" | "restricted";
  required: boolean;
  verifiedBy: string;
  state: ItemState;
  verifiedAt: string | null;
  expiresAt: string | null;
  hash: string | null;
}

interface ThresholdOption {
  did: string;
  name: string;
  current: boolean;
  notice: string | null;
}

interface Release {
  item: string;
  label: string;
  toConnector: string;
  at: string;
  engagementId: string;
  employer: string;
}

interface Payload {
  worker: { did: string; name: string; role: string };
  at: string;
  agreementTemplateVersion: string;
  completeness: {
    ok: boolean;
    progress: number;
    held: number;
    required: number;
    missing: { kind: string; label: string; blurb: string }[];
    expiringSoon: { kind: string; label: string; expiresAt: string; daysLeft: number }[];
  };
  items: Item[];
  threshold: {
    primaryEmployerDid: string | null;
    primaryEmployerName: string | null;
    options: ThresholdOption[];
  };
  releases: Release[];
}

const STATE: Record<ItemState, { tone: string; label: string }> = {
  valid: { tone: "success", label: "Verified" },
  expired: { tone: "danger", label: "Expired" },
  revoked: { tone: "danger", label: "Revoked" },
  missing: { tone: "warning", label: "Not yet" },
};

const CONNECTOR_LABEL: Record<string, string> = {
  mock: "demo payroll",
  xero: "Xero Payroll",
  keypay: "KeyPay",
  employment_hero: "Employment Hero",
  myob: "MYOB",
  connecteam_payroll: "Connecteam Payroll",
};

const dateLabel = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

export default function PackPage() {
  const [me, setMe] = useState<Signed | null>(null);
  const [ready, setReady] = useState(false);
  const [payload, setPayload] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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
      const res = await fetch("/api/pack");
      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
      setPayload(await res.json());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load your pack");
    }
  }, []);

  useEffect(() => {
    if (me) void load();
  }, [me, load]);

  async function nominate(did: string | null) {
    setSaving(true);
    try {
      await fetch("/api/pack", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ primaryEmployerDid: did }),
      });
      await load();
    } finally {
      setSaving(false);
    }
  }

  if (!ready) return null;
  if (!me) return <SignIn onSignedIn={setMe} />;

  const c = payload?.completeness;

  return (
    <div style={{ padding: "14px 14px 28px" }}>
      <header style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 14 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ margin: 0, fontSize: 21, letterSpacing: "-.02em" }}>Your pack</h1>
          <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--fg-4)" }}>
            Verified once. Used at every venue.
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

      <MobileNav current="/m/pack" />

      {error && (
        <div style={{ background: "var(--danger-bg)", color: "var(--danger-fg)", borderRadius: 10, padding: "10px 12px", fontSize: 13, marginBottom: 12 }}>
          {error}
        </div>
      )}
      {!payload && !error && <p style={{ fontSize: 13, color: "var(--fg-4)" }}>Loading your pack…</p>}

      {payload && c && (
        <>
          <section
            style={{
              background: c.ok ? "var(--fs-navy, #0a1a28)" : "#fff",
              color: c.ok ? "#fff" : "var(--fg-1)",
              border: c.ok ? "none" : "1px solid var(--warning)",
              borderRadius: 14, padding: "15px 15px", marginBottom: 14,
            }}
          >
            <p style={{ margin: 0, display: "flex", alignItems: "baseline", gap: 8, color: "inherit" }}>
              <span className="fs-tnum" style={{ fontSize: 30, fontWeight: 800, letterSpacing: "-.02em" }}>
                {c.held}/{c.required}
              </span>
              <span style={{ fontSize: 13, opacity: c.ok ? 0.7 : 1, color: c.ok ? "#fff" : "var(--fg-3)" }}>
                verified
              </span>
            </p>

            <div
              style={{
                height: 6, borderRadius: 999, marginTop: 10, overflow: "hidden",
                background: c.ok ? "rgba(255,255,255,.18)" : "var(--bg-2, #eef1f4)",
              }}
            >
              <div
                style={{
                  width: `${Math.round(c.progress * 100)}%`, height: "100%",
                  background: c.ok ? "var(--fs-teal-bright, #12d9c6)" : "var(--warning)",
                }}
              />
            </div>

            <p style={{ margin: "12px 0 0", fontSize: 13, lineHeight: 1.55, color: c.ok ? "#fff" : "var(--fg-2)" }}>
              {c.ok
                ? "Your pack is complete. A shift at any venue on Covers is one tap — they employ you, and nobody re-types any of this."
                : `You can't accept a shift until this is complete. ${c.missing.length} to go.`}
            </p>

            {!c.ok && (
              <ul style={{ margin: "10px 0 0", paddingLeft: 18, fontSize: 13, lineHeight: 1.6, color: "var(--fg-2)" }}>
                {c.missing.map((m) => (
                  <li key={m.kind}>
                    <strong>{m.label}</strong> — {m.blurb}
                  </li>
                ))}
              </ul>
            )}

            {c.expiringSoon.length > 0 && (
              <p style={{ margin: "10px 0 0", fontSize: 12.5, color: c.ok ? "#ffd28a" : "var(--warning-fg)" }}>
                {c.expiringSoon
                  .map((e) => `${e.label} expires in ${e.daysLeft} day${e.daysLeft === 1 ? "" : "s"}`)
                  .join(" · ")}
              </p>
            )}
          </section>

          <h2 style={heading}>What&rsquo;s in it</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 18 }}>
            {payload.items.map((i) => (
              <ItemRow key={i.kind} i={i} />
            ))}
          </div>

          <h2 style={heading}>Tax-free threshold</h2>
          <section style={card}>
            <p style={{ margin: "0 0 10px", fontSize: 13, lineHeight: 1.55, color: "var(--fg-2)" }}>
              Claim it with <strong>one</strong> employer — the one you expect to earn the most from.
              Claiming it twice under-withholds all year and lands as a bill.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {payload.threshold.options.map((o) => (
                <button
                  key={o.did}
                  disabled={saving}
                  onClick={() => void nominate(o.current ? null : o.did)}
                  style={{
                    display: "block", width: "100%", textAlign: "left", minHeight: 44,
                    padding: "10px 12px", borderRadius: 10, cursor: saving ? "default" : "pointer",
                    border: `1px solid ${o.current ? "var(--accent, var(--fg-1))" : "var(--border)"}`,
                    background: o.current ? "var(--accent-bg, var(--bg-2))" : "#fff",
                    fontSize: 13.5, fontWeight: 600, color: "var(--fg-1)",
                  }}
                >
                  {o.current ? "✓ " : ""}
                  {o.name}
                  <span style={{ display: "block", fontWeight: 400, fontSize: 12, color: "var(--fg-4)", marginTop: 2 }}>
                    {o.current ? "Claiming here — tap to clear" : "Tap to claim here instead"}
                  </span>
                </button>
              ))}
            </div>
            {!payload.threshold.primaryEmployerDid && (
              <p style={{ margin: "10px 0 0", fontSize: 12.5, color: "var(--warning-fg)", lineHeight: 1.5 }}>
                Not claimed anywhere. Every employer withholds at the higher rate until you choose —
                you get it back at tax time, but your pay is lower until then.
              </p>
            )}
            <p style={{ margin: "10px 0 0", fontSize: 11.5, color: "var(--fg-4)", lineHeight: 1.5 }}>
              Changing this affects engagements you accept from now on. One already signed keeps the
              answer it was signed with, because that is what was lodged with the ATO.
            </p>
          </section>

          <h2 style={heading}>Where your details have gone</h2>
          <section style={card}>
            {payload.releases.length === 0 ? (
              <p style={{ margin: 0, fontSize: 13, color: "var(--fg-3)", lineHeight: 1.55 }}>
                Nothing has left your pack yet. The locked items are only ever sent when you accept
                a shift, and only to that venue&rsquo;s payroll.
              </p>
            ) : (
              <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
                {payload.releases.map((r, n) => (
                  <li
                    key={`${r.engagementId}-${r.item}-${n}`}
                    style={{
                      padding: "8px 0",
                      borderTop: n === 0 ? "none" : "1px solid var(--border)",
                      fontSize: 13, lineHeight: 1.5,
                    }}
                  >
                    <strong>{r.label}</strong> → {CONNECTOR_LABEL[r.toConnector] ?? r.toConnector}
                    <span style={{ display: "block", fontSize: 12, color: "var(--fg-4)" }}>
                      {r.employer} · {dateLabel(r.at)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <p style={{ margin: "16px 0 0", fontSize: 11.5, color: "var(--fg-4)", lineHeight: 1.55 }}>
            Casual agreement {payload.agreementTemplateVersion}. Checked as at {dateLabel(payload.at)}.
          </p>
        </>
      )}
    </div>
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

const card: React.CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 12,
  padding: "12px 13px",
  marginBottom: 18,
  background: "#fff",
};

function ItemRow({ i }: { i: Item }) {
  const s = STATE[i.state];
  return (
    <div
      style={{
        padding: "11px 13px", borderRadius: 12, background: "#fff",
        border: `1px solid ${i.state === "valid" ? "var(--border)" : "var(--border-2)"}`,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
        <div style={{ minWidth: 0 }}>
          <strong style={{ fontSize: 14.5, color: "var(--fg-1)" }}>
            {/* The lock says a thing no venue can see. It is the shortest way to
                explain why handing this over once is not the same as handing it
                to everyone. */}
            {i.sensitivity === "restricted" && (
              <span title="Only released to a payroll you approve" style={{ marginRight: 5 }}>
                🔒
              </span>
            )}
            {i.label}
          </strong>
          <span style={{ display: "block", fontSize: 12, color: "var(--fg-4)", marginTop: 2 }}>
            {i.blurb}
          </span>
        </div>
        <span
          style={{
            flexShrink: 0, fontSize: 11, fontWeight: 700, borderRadius: 999, padding: "3px 8px",
            color: `var(--${s.tone}-fg)`, background: `var(--${s.tone}-bg)`,
          }}
        >
          {s.label}
        </span>
      </div>

      <div style={{ fontSize: 11.5, color: "var(--fg-4)", marginTop: 7, lineHeight: 1.5 }}>
        {i.state === "missing" ? (
          <>Not in your pack yet · checked by {i.verifiedBy}</>
        ) : (
          <>
            {i.verifiedBy} · {i.verifiedAt ? dateLabel(i.verifiedAt) : ""}
            {i.expiresAt && ` · ${i.state === "expired" ? "expired" : "expires"} ${dateLabel(i.expiresAt)}`}
          </>
        )}
      </div>

      {/* The digest, rendered small. It is the only part of a locked item that
          can be shown at all, and it is what lets somebody check that the
          agreement they signed pinned this exact record. */}
      {i.hash && (
        <div className="fs-tnum" style={{ fontSize: 10.5, color: "var(--fg-4)", marginTop: 4, opacity: 0.8 }}>
          {i.hash.slice(0, 16)}…
        </div>
      )}
    </div>
  );
}
