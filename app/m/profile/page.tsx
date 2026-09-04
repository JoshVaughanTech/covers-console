"use client";

import { useCallback, useEffect, useState } from "react";
import { SignIn, type Signed } from "../sign-in";
import { MobileNav } from "../nav";

/* ============================================================
   The worker's own profile.

   The argument this screen makes is one sentence: WHAT IS HERE WAS
   VERIFIED, NOT SELF-DECLARED. That is the difference between Covers
   and a gig app where a licence is a photo somebody uploaded, and it
   only holds if the screen never states anything the system has not
   checked. So every figure arrives computed from /api/profile —
   credential state from the same standingOf() the console renders,
   the award floor from the same floorHourly() that refuses an
   underpaying posting, and "unlocks 4 shifts" from the gate's own
   answer to a counterfactual rather than a guess.

   What is deliberately absent is the point as much as what is here.
   The mockup this came from shows lifetime shifts, venues worked and
   a reliability percentage. Nothing records shift history yet, so
   all three would be invented — and inventing a number on the screen
   whose whole claim is "this was checked" would cost the claim
   everything. They arrive when there is something to count.
   ============================================================ */

type HeldState = "current" | "expiring" | "expired" | "revoked" | "suspended";
type StandingState = "current" | "expiring" | "action_needed";

interface Credential {
  type: string;
  shortLabel: string;
  label: string;
  authority: string;
  state: HeldState;
  expiresAt: string | null;
  daysLeft: number | null;
}

interface Unlock {
  type: string;
  shortLabel: string;
  label: string;
  authority: string;
  siteScoped: boolean;
  siteName: string | null;
  shifts: number;
}

interface Profile {
  worker: { did: string; name: string; role: string };
  at: string;
  standing: StandingState;
  credentials: Credential[];
  unlocks: Unlock[];
  skills: { skill: string; label: string; level: string }[];
  rating: number | null;
  hours: { thisWeek: number; fullWeek: number } | null;
  award: {
    level: string | number;
    levelLabel: string;
    employment: string;
    weekdayFloorCents: number;
    weekdayFloor: string;
    awardId: string;
  } | null;
}

const CRED_TONE: Record<HeldState, { tone: string; label: string }> = {
  current: { tone: "success", label: "Verified" },
  expiring: { tone: "warning", label: "Expiring" },
  expired: { tone: "danger", label: "Expired" },
  revoked: { tone: "danger", label: "Revoked" },
  suspended: { tone: "danger", label: "Suspended" },
};

const STANDING_COPY: Record<StandingState, { tone: string; text: string }> = {
  current: { tone: "success", text: "✓ Idara verified" },
  expiring: { tone: "warning", text: "Something needs renewing" },
  action_needed: { tone: "danger", text: "Action needed" },
};

const EMPLOYMENT_LABEL: Record<string, string> = {
  casual: "Casual",
  full_time: "Full-time",
  part_time: "Part-time",
};

/** "2027-03-14" → "Mar 2027". Month and year is all an expiry needs to convey. */
const monthYear = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-AU", { month: "short", year: "numeric", timeZone: "UTC" });

export default function MobileProfilePage() {
  const [me, setMe] = useState<Signed | null>(null);
  const [ready, setReady] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      const res = await fetch("/api/profile");
      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
      setProfile(await res.json());
      setError(null);
    } catch (e) {
      // a profile that failed to load must say so. An empty credentials list
      // reads as "you hold nothing", which is a different and alarming claim
      setError(e instanceof Error ? e.message : "Could not load your profile");
    }
  }, []);

  useEffect(() => {
    if (me) void load();
  }, [me, load]);

  if (!ready) return null;
  if (!me) return <SignIn onSignedIn={setMe} />;

  const standing = profile ? STANDING_COPY[profile.standing] : null;

  return (
    <div style={{ padding: "14px 14px 28px" }}>
      <header style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 14 }}>
        <div
          style={{
            width: 52, height: 52, borderRadius: 14, flexShrink: 0,
            background: "var(--fs-teal, #0d8b82)", color: "#fff",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 18, fontWeight: 800, letterSpacing: "-.02em",
          }}
        >
          {me.name.split(" ").map((n) => n[0]).slice(0, 2).join("")}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ margin: 0, fontSize: 21, letterSpacing: "-.02em" }}>{me.name}</h1>
          <p style={{ margin: "2px 0 0", fontSize: 12.5, color: "var(--fg-4)" }}>
            {me.role}
            {profile?.award && ` · ${EMPLOYMENT_LABEL[profile.award.employment] ?? profile.award.employment}`}
            {profile?.rating != null && ` · ★ ${profile.rating.toFixed(1)}`}
          </p>
        </div>
        <button
          onClick={() => {
            void fetch("/api/auth/session", { method: "DELETE" }).finally(() => {
              setMe(null);
              setProfile(null);
            });
          }}
          style={{
            border: "1px solid var(--border-2)", background: "#fff", borderRadius: 999,
            padding: "6px 12px", fontSize: 12, fontWeight: 600, color: "var(--fg-2)", cursor: "pointer",
            flexShrink: 0,
          }}
        >
          Sign out
        </button>
      </header>

      <MobileNav current="/m/profile" />

      {standing && (
        <div
          style={{
            display: "inline-block", marginBottom: 14, borderRadius: 999, padding: "5px 12px",
            fontSize: 12.5, fontWeight: 700,
            background: `var(--${standing.tone}-bg)`, color: `var(--${standing.tone}-fg)`,
          }}
        >
          {standing.text}
        </div>
      )}

      {error && <Banner tone="danger">{error}</Banner>}
      {!profile && !error && <p style={{ fontSize: 13, color: "var(--fg-4)" }}>Loading your profile…</p>}

      {profile && (
        <>
          <Section title="Credentials">
            {profile.credentials.length === 0 && (
              <Row>
                <span style={{ fontSize: 13, color: "var(--fg-4)" }}>
                  Nothing on file yet. Your venue adds these — you cannot upload them yourself, which is
                  what makes them worth something.
                </span>
              </Row>
            )}
            {profile.credentials.map((c) => {
              const tone = CRED_TONE[c.state];
              return (
                <Row key={c.type}>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 14, fontWeight: 600, color: "var(--fg-1)" }}>
                      {c.shortLabel}
                    </span>
                    <span style={{ display: "block", fontSize: 11.5, color: "var(--fg-4)" }}>{c.authority}</span>
                  </span>
                  <span style={{ textAlign: "right", flexShrink: 0 }}>
                    <span style={{ display: "block", fontSize: 12.5, fontWeight: 700, color: `var(--${tone.tone}-fg)` }}>
                      {c.state === "current" ? "✓ " : ""}
                      {tone.label}
                    </span>
                    {c.expiresAt && (
                      <span className="fs-tnum" style={{ display: "block", fontSize: 11.5, color: "var(--fg-4)" }}>
                        {c.state === "expired" ? "expired " : ""}
                        {monthYear(c.expiresAt)}
                      </span>
                    )}
                  </span>
                </Row>
              );
            })}
            <p style={{ margin: "8px 2px 0", fontSize: 11.5, lineHeight: 1.5, color: "var(--fg-4)" }}>
              Checked against the issuer by Idara, not uploaded by you. Venues can&rsquo;t ask you to
              re-prove any of this.
            </p>
          </Section>

          {/* The one place on this screen that tells someone to go and do
              something, so it is the one place the number has to be exact. It
              is the gate's own answer to "what if they held this", not a
              reading of the refusals. */}
          {profile.unlocks.length > 0 && (
            <Section title="Would open more work">
              {profile.unlocks.map((u) => (
                // keyed by venue too: a scoped credential legitimately appears
                // once per site, and keying on type alone collapses them
                <Row key={`${u.type}@${u.siteName ?? ""}`}>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 14, fontWeight: 600, color: "var(--fg-1)" }}>
                      {u.shortLabel}
                      {u.siteName && <span style={{ fontWeight: 500, color: "var(--fg-3)" }}> · {u.siteName}</span>}
                    </span>
                    <span style={{ display: "block", fontSize: 11.5, color: "var(--fg-4)" }}>
                      {u.siteScoped ? "Ask this venue — an induction only counts where it was issued" : u.authority}
                    </span>
                  </span>
                  <span
                    style={{
                      flexShrink: 0, fontSize: 12, fontWeight: 700, borderRadius: 999, padding: "4px 10px",
                      background: "var(--info-bg)", color: "var(--info-fg)",
                    }}
                  >
                    unlocks {u.shifts} shift{u.shifts === 1 ? "" : "s"}
                  </span>
                </Row>
              ))}
              <p style={{ margin: "8px 2px 0", fontSize: 11.5, lineHeight: 1.5, color: "var(--fg-4)" }}>
                Counted by re-running the eligibility check as if you held it — these shifts open, not
                &ldquo;might&rdquo;.
              </p>
            </Section>
          )}

          {profile.skills.length > 0 && (
            <Section title="Skills">
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {profile.skills.map((s) => (
                  <span
                    key={s.skill}
                    style={{
                      fontSize: 12, fontWeight: 600, borderRadius: 999, padding: "6px 11px",
                      border: "1px solid var(--border-2)", background: "#fff", color: "var(--fg-2)",
                    }}
                  >
                    {s.label} · {s.level}
                  </span>
                ))}
              </div>
            </Section>
          )}

          {profile.award && (
            <Section title="Your rate">
              <div
                style={{
                  border: "1px solid var(--border-2)", borderRadius: 12, padding: "13px 14px", background: "#fff",
                }}
              >
                <div style={{ fontSize: 12, color: "var(--fg-4)" }}>
                  Award floor · {profile.award.levelLabel} ·{" "}
                  {EMPLOYMENT_LABEL[profile.award.employment] ?? profile.award.employment}
                </div>
                <div
                  className="fs-tnum"
                  style={{ fontSize: 27, fontWeight: 800, letterSpacing: "-.02em", color: "var(--fg-1)", marginTop: 2 }}
                >
                  {profile.award.weekdayFloor}
                  <span style={{ fontSize: 13, fontWeight: 500, color: "var(--fg-4)" }}>/h weekday</span>
                </div>
                <p style={{ margin: "8px 0 0", fontSize: 12, lineHeight: 1.55, color: "var(--fg-3)" }}>
                  The legal minimum for your classification under {profile.award.awardId}. Evening, weekend
                  and public holiday hours are paid above it automatically — a shift never pays this flat.
                </p>
                <p style={{ margin: "6px 0 0", fontSize: 11.5, lineHeight: 1.5, color: "var(--fg-4)" }}>
                  Covers won&rsquo;t publish a shift below the floor for the hours it actually covers.
                </p>
              </div>
            </Section>
          )}

          {profile.hours && (
            <Section title="This week">
              <div
                style={{
                  border: "1px solid var(--border-2)", borderRadius: 12, padding: "13px 14px", background: "#fff",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <span className="fs-tnum" style={{ fontSize: 20, fontWeight: 800, color: "var(--fg-1)" }}>
                    {profile.hours.thisWeek}h
                    <span style={{ fontSize: 13, fontWeight: 500, color: "var(--fg-4)" }}>
                      {" "}of {profile.hours.fullWeek}
                    </span>
                  </span>
                  <span style={{ fontSize: 12, color: "var(--fg-4)" }}>
                    {profile.hours.thisWeek >= profile.hours.fullWeek
                      ? "At a full week"
                      : `Room for ${profile.hours.fullWeek - profile.hours.thisWeek}h more`}
                  </span>
                </div>
                <div
                  style={{
                    marginTop: 9, height: 7, borderRadius: 999, background: "var(--bg-2)", overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: `${Math.min(100, (profile.hours.thisWeek / profile.hours.fullWeek) * 100)}%`,
                      height: "100%",
                      background: profile.hours.thisWeek >= profile.hours.fullWeek ? "var(--warning)" : "var(--fs-teal, #0d8b82)",
                    }}
                  />
                </div>
              </div>
            </Section>
          )}
        </>
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

function Row({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex", alignItems: "center", gap: 12, minHeight: 54,
        padding: "10px 13px", borderRadius: 12,
        border: "1px solid var(--border-2)", background: "#fff",
      }}
    >
      {children}
    </div>
  );
}

function Banner({ tone, children }: { tone: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        background: `var(--${tone}-bg)`, color: `var(--${tone}-fg)`, borderRadius: 10,
        padding: "10px 12px", fontSize: 13, lineHeight: 1.5, marginBottom: 12,
      }}
    >
      {children}
    </div>
  );
}
