"use client";

/* ============================================================
   Open Shifts — post shifts, let staff claim, let the matcher
   explain who fits.

   The rule this screen exists to make visible: Idara eligibility
   is a gate, not a score. An ineligible person never appears in
   the ranking, and a shift a person can't work never appears as
   claimable to them. Both halves call the same decideMember(), so
   the manager's view and the worker's view cannot disagree.
   ============================================================ */

import { useCallback, useMemo, useState } from "react";
import {
  Avatar,
  Badge,
  Button,
  Card,
  Field,
  Icon,
  MetricCard,
  Modal,
  Select,
  Tabs,
  TextField,
  useToast,
} from "@/components/ui";
import { PageHead, CardHead } from "@/components/screen/page-head";
import {
  useIdara,
  decideMember,
  LocalCredentialVerifier,
  ALL_WORK_FUNCTIONS,
  ROLE_FUNCTIONS,
  type Decision,
  type WorkFunction,
} from "@/lib/idara";
import { SKILLS, profileOf, type SkillId, type SkillLevel } from "@/lib/people";
import {
  POSTINGS,
  seatsLeft,
  openClaims,
  claimShift,
  hasClaimed,
  buildPosting,
  emptyDraft,
  dutiesForRole,
  type PostingDraft,
  type ShiftPosting,
} from "@/lib/shifts";
import { rankForShift, WEIGHTS, type MatchResult, type ScoreReason } from "@/lib/matching";

const STATUS_TONE = {
  draft: "neutral",
  open: "info",
  needs_review: "warning",
  filled: "success",
} as const;

const DUTY_LABEL: Record<WorkFunction, string> = {
  serve_alcohol: "Serve alcohol",
  handle_food: "Handle food",
  gaming: "Gaming",
  supervise: "Supervise",
};

const STATUS_LABEL = {
  draft: "Draft",
  open: "Open",
  needs_review: "Needs review",
  filled: "Filled",
} as const;

/** score chips are green when they help, amber when they cost */
function chipStyle(points: number) {
  if (points > 0) return { bg: "var(--success-bg)", fg: "var(--success-fg)" };
  if (points < 0) return { bg: "var(--warning-bg)", fg: "var(--warning-fg)" };
  return { bg: "var(--bg-2)", fg: "var(--fg-3)" };
}

function ScoreChip({ reason }: { reason: ScoreReason }) {
  const { bg, fg } = chipStyle(reason.points);
  const sign = reason.points > 0 ? "+" : "";
  return (
    <span
      style={{
        background: bg,
        color: fg,
        fontSize: 11.5,
        fontWeight: 600,
        padding: "4px 9px",
        borderRadius: 999,
        whiteSpace: "nowrap",
      }}
    >
      {reason.points !== 0 && `${sign}${reason.points} · `}
      {reason.detail}
    </span>
  );
}

export default function OpenShiftsPage() {
  const toast = useToast();
  const { workers, credentials, site, sites, today, recordEvent, worker } = useIdara();
  const verifier = useMemo(() => new LocalCredentialVerifier(), []);

  const [postings, setPostings] = useState<ShiftPosting[]>(POSTINGS);
  const [view, setView] = useState<"Manage" | "Staff view">("Manage");
  const [matching, setMatching] = useState<ShiftPosting | null>(null);
  const [postOpen, setPostOpen] = useState(false);
  const [draft, setDraft] = useState<PostingDraft>(emptyDraft);
  const [draftErrors, setDraftErrors] = useState<string[]>([]);
  const [staffDid, setStaffDid] = useState(
    () => workers.find((w) => w.name === "Jake Morrison")?.did ?? workers[0].did,
  );

  /* everyone, in the shape the matcher wants */
  const people = useMemo(
    () =>
      workers.map((person) => ({
        person,
        credentials: credentials.filter((c) => c.subject === person.did),
        profile: profileOf(person.did),
      })),
    [workers, credentials],
  );

  const result: MatchResult | null = useMemo(() => {
    if (!matching) return null;
    const s = site(matching.siteId);
    if (!s) return null;
    return rankForShift({ posting: matching, site: s, people, at: today, verifier });
  }, [matching, site, people, today, verifier]);

  /* ---- headline numbers ---- */
  const openCount = postings.filter((p) => p.status === "open").length;
  const seatsToFill = postings
    .filter((p) => p.status !== "draft")
    .reduce((n, p) => n + seatsLeft(p), 0);
  const claimCount = postings.reduce((n, p) => n + openClaims(p).length, 0);
  const filledCount = postings.filter((p) => p.status === "filled").length;

  /* ---- assigning ---- */
  const assign = (posting: ShiftPosting, did: string, name: string) => {
    const next = postings.map((p) =>
      p.id === posting.id
        ? {
            ...p,
            assigned: [...p.assigned, did],
            status: (p.assigned.length + 1 >= p.seats ? "filled" : p.status) as ShiftPosting["status"],
          }
        : p,
    );
    setPostings(next);

    // the assignment lands on the same hash chain as publishes and revocations
    recordEvent({
      type: "shift.assigned",
      at: today,
      actor: "Emma Taylor",
      subject: did,
      summary: `${name} assigned to ${posting.role} on ${posting.functionName}`,
      data: { postingId: posting.id, siteId: posting.siteId, role: posting.role },
    });

    setMatching(next.find((p) => p.id === posting.id) ?? null);
    toast(`${name} assigned to ${posting.role} · ${posting.functionName}`, {
      tone: "success",
      icon: "user-check",
    });
  };

  /* One answer to "can this person take this shift?", used both to render
     the row and to enforce the claim. Hiding a button is presentation, and
     presentation is not a gate — so the claim re-runs this rather than
     trusting the control that was rendered. */
  const blockReasonFor = useCallback(
    (p: ShiftPosting, did: string): string | null => {
      const person = worker(did);
      const s = site(p.siteId);
      if (!person || !s) return "Not eligible";

      const decision: Decision = decideMember({
        person,
        credentials: credentials.filter((c) => c.subject === did),
        action: "be_rostered",
        site: s,
        at: today,
        verifier,
        shifts: [{ id: p.shiftId, duties: p.duties }],
      });

      // two refusals from different layers, deliberately kept apart:
      // a credential fact, and a commercial one
      if (!decision.allowed) {
        return decision.reasons.find((r) => r.outcome === "fail")?.detail ?? "Not eligible";
      }
      if (p.client && profileOf(did)?.excludedClients?.includes(p.client)) {
        return "Not available for this client";
      }
      return null;
    },
    [worker, site, credentials, today, verifier],
  );

  /* ---- posting a shift ----
     The duty chips default to what the role implies and stay editable,
     because duties are per-shift: a Bartender covering the gaming room on
     Saturday is doing different regulated work from the same person behind
     the main bar on Tuesday. */
  const openPostModal = () => {
    setDraft(emptyDraft());
    setDraftErrors([]);
    setPostOpen(true);
  };

  const setRole = (role: string) =>
    setDraft((d) => ({ ...d, role, duties: dutiesForRole(role) }));

  /* Skills are stored in catalogue order rather than click order, so the
     chips on the board read the same way for every posting. */
  const setSkill = (skill: SkillId, level: string) =>
    setDraft((d) => {
      const held = new Map(d.requires.map((r) => [r.skill, r.level]));
      if (level) held.set(skill, level as SkillLevel);
      else held.delete(skill);
      return {
        ...d,
        requires: (Object.keys(SKILLS) as SkillId[])
          .filter((s) => held.has(s))
          .map((s) => ({ skill: s, level: held.get(s)! })),
      };
    });

  const toggleDuty = (fn: WorkFunction) =>
    setDraft((d) => ({
      ...d,
      duties: d.duties.includes(fn) ? d.duties.filter((x) => x !== fn) : [...d.duties, fn],
    }));

  const submitPosting = () => {
    const id = `sp-new-${postings.length + 1}`;
    const result = buildPosting(draft, id, draft.day.trim().slice(0, 3) || "Shift");
    if (!result.ok) {
      setDraftErrors(result.errors);
      return;
    }
    setPostings((prev) => [result.posting, ...prev]);
    setPostOpen(false);
    toast(
      result.posting.status === "open"
        ? `Posted — ${result.posting.role} · ${result.posting.functionName}`
        : `Saved as draft — ${result.posting.role}`,
      { tone: "success", icon: "plus" },
    );
  };

  /* ---- what one person sees ---- */
  const staffView = useMemo(() => {
    if (!worker(staffDid)) return [];
    return postings
      .filter((p) => p.status !== "draft" && !p.assigned.includes(staffDid))
      .map((p) => ({
        posting: p,
        blocked: blockReasonFor(p, staffDid),
        claimed: hasClaimed(p, staffDid),
      }));
  }, [staffDid, postings, worker, blockReasonFor]);

  /* ---- claiming ----
     A claim is a request, never a roster change: it adds the person to the
     manager's queue and nothing more. The assignment that may follow is a
     separate decision, separately audited. */
  const claim = (p: ShiftPosting) => {
    const person = worker(staffDid);
    if (!person) return;

    const result = claimShift(p, staffDid, today, blockReasonFor(p, staffDid));
    if (!result.ok) {
      toast(result.reason, {
        tone: result.kind === "blocked" ? "danger" : "info",
        ...(result.kind === "blocked" ? { icon: "shield-alert" as const } : {}),
      });
      return;
    }

    setPostings((prev) => prev.map((x) => (x.id === p.id ? result.posting : x)));

    recordEvent({
      type: "shift.claimed",
      at: today,
      actor: person.name,
      subject: staffDid,
      summary: `${person.name} claimed ${p.role} on ${p.functionName}`,
      data: { postingId: p.id, siteId: p.siteId, role: p.role },
    });

    toast(`Claim submitted — ${p.role} · ${p.functionName}`, { tone: "success", icon: "hand" });
  };

  const staffProfile = profileOf(staffDid);
  const staffPerson = worker(staffDid);

  return (
    <div>
      <PageHead
        title="Open Shifts"
        sub="Post shifts, let staff claim them, and let the matcher tell you who fits — with reasons, and Idara in the loop."
        right={
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Tabs
              tabs={["Manage", "Staff view"]}
              value={view}
              onChange={(v) => setView(v as "Manage" | "Staff view")}
            />
            <Button size="sm" icon="plus" onClick={openPostModal}>
              Post a shift
            </Button>
          </div>
        }
      />

      {view === "Manage" ? (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 16 }}>
            <MetricCard label="Open Shifts" value={String(openCount)} status={`${seatsToFill} seats to fill`} />
            <MetricCard label="Claims to Review" value={String(claimCount)} status="Staff have put their hand up" />
            <MetricCard label="Filled" value={String(filledCount)} status="This week" />
            <MetricCard label="Matcher" value="Live" status="Idara-gated · explainable" />
          </div>

          <Card pad={0}>
            <div style={{ padding: "14px 16px" }}>
              <CardHead title="Shift Postings" />
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <tbody>
                {postings.map((p) => (
                  <tr
                    key={p.id}
                    style={{ borderTop: "1px solid var(--border)", cursor: p.status === "draft" ? "default" : "pointer" }}
                    onClick={() => p.status !== "draft" && setMatching(p)}
                  >
                    <td style={{ padding: "12px 16px", minWidth: 220 }}>
                      <div style={{ fontWeight: 700, color: "var(--fg-1)", fontSize: 13.5 }}>
                        {p.role} <span style={{ color: "var(--fg-4)", fontWeight: 500 }}>× {p.seats}</span>
                      </div>
                      <div style={{ fontSize: 11.5, color: "var(--fg-4)" }}>
                        {p.functionRef ? `${p.functionRef} · ` : ""}
                        {p.functionName}
                        {p.client ? ` · ${p.client}` : ""}
                      </div>
                    </td>
                    <td style={{ padding: "12px 8px" }}>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {p.requires.map((r) => (
                          <span
                            key={r.skill}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 5,
                              background: "var(--bg-2)",
                              color: "var(--fg-2)",
                              fontSize: 11,
                              fontWeight: 600,
                              padding: "4px 9px",
                              borderRadius: 999,
                            }}
                          >
                            <Icon name={SKILLS[r.skill].icon} size={12} />
                            {SKILLS[r.skill].label}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td style={{ padding: "12px 8px", whiteSpace: "nowrap" }}>
                      <div style={{ fontWeight: 700, color: "var(--fg-1)" }}>{p.day}</div>
                      <div className="fs-tnum" style={{ fontSize: 11.5, color: "var(--fg-4)" }}>
                        {p.window} · {site(p.siteId)?.region ?? ""}
                      </div>
                    </td>
                    <td className="fs-tnum" style={{ padding: "12px 8px", textAlign: "right", fontWeight: 700, color: seatsLeft(p) ? "var(--warning-fg)" : "var(--success-fg)" }}>
                      {p.assigned.length}/{p.seats}
                    </td>
                    <td style={{ padding: "12px 8px", textAlign: "right" }}>
                      {openClaims(p).length > 0 && (
                        <Badge tone="warning" icon="hand">{openClaims(p).length}</Badge>
                      )}
                    </td>
                    <td style={{ padding: "12px 16px", textAlign: "right" }}>
                      <Badge tone={STATUS_TONE[p.status]} dot>{STATUS_LABEL[p.status]}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 16, alignItems: "start" }}>
          <Card pad={0}>
            <div style={{ padding: "14px 16px", display: "flex", alignItems: "center", gap: 10 }}>
              <Icon name="smartphone" size={16} color="var(--fg-3)" />
              <h4 style={{ margin: 0, fontSize: 15 }}>What {staffPerson?.name.split(" ")[0]} sees</h4>
              <div style={{ flex: 1 }} />
              <select
                value={staffDid}
                onChange={(e) => setStaffDid(e.target.value)}
                style={{ font: "inherit", fontSize: 12.5, padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border-2)", background: "#fff", color: "var(--fg-1)" }}
              >
                {workers.map((w) => (
                  <option key={w.did} value={w.did}>{w.name} · {w.role}</option>
                ))}
              </select>
            </div>
            {staffView.map(({ posting: p, blocked, claimed }) => (
              <div key={p.id} style={{ borderTop: "1px solid var(--border)", padding: "14px 16px" }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, color: "var(--fg-1)", fontSize: 13.5 }}>
                      {p.role} · {p.day} {p.window}
                    </div>
                    <div style={{ fontSize: 11.5, color: "var(--fg-4)", marginBottom: 8 }}>
                      {p.functionRef ? `${p.functionRef} · ` : ""}{p.functionName}
                    </div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {p.requires.map((r) => (
                        <span key={r.skill} style={{ background: blocked ? "var(--danger-bg)" : "var(--success-bg)", color: blocked ? "var(--danger-fg)" : "var(--success-fg)", fontSize: 11, fontWeight: 600, padding: "4px 9px", borderRadius: 999 }}>
                          {SKILLS[r.skill].label} · {r.level}
                        </span>
                      ))}
                    </div>
                    {blocked && (
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, fontSize: 12, color: "var(--danger-fg)" }}>
                        <Icon name="shield-alert" size={13} />
                        {blocked}
                      </div>
                    )}
                  </div>
                  <div style={{ textAlign: "right" }}>
                    {blocked ? (
                      <Badge tone="neutral">Not available</Badge>
                    ) : claimed ? (
                      <Badge tone="teal" icon="hand">Claim submitted</Badge>
                    ) : (
                      <Button size="sm" icon="hand" onClick={() => claim(p)}>
                        Claim
                      </Button>
                    )}
                    <div style={{ fontSize: 11, color: "var(--fg-4)", marginTop: 6 }}>
                      {seatsLeft(p)} of {p.seats} left
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </Card>

          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <Card pad={16}>
              <CardHead title="Profile" />
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <Avatar name={staffPerson?.name ?? ""} size={40} />
                <div>
                  <div style={{ fontWeight: 700, color: "var(--fg-1)", fontSize: 14 }}>{staffPerson?.name}</div>
                  <div style={{ fontSize: 11.5, color: "var(--fg-4)" }}>
                    {staffPerson?.role} · {site(staffProfile?.homeSiteId ?? "")?.name ?? ""}
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 24, marginBottom: 12 }}>
                <div>
                  <div style={{ fontSize: 11.5, color: "var(--fg-4)" }}>This week</div>
                  <div className="fs-tnum" style={{ fontSize: 20, fontWeight: 800, color: "var(--fg-1)" }}>{staffProfile?.hoursThisWeek}h</div>
                </div>
                <div>
                  <div style={{ fontSize: 11.5, color: "var(--fg-4)" }}>Rating</div>
                  <div className="fs-tnum" style={{ fontSize: 20, fontWeight: 800, color: "var(--fg-1)" }}>{staffProfile?.rating.toFixed(1)}</div>
                </div>
              </div>
              <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", color: "var(--fg-4)", letterSpacing: ".04em", marginBottom: 6 }}>Skills</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {Object.entries(staffProfile?.skills ?? {}).map(([id, level]) => (
                  <span key={id} style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "var(--bg-2)", color: "var(--fg-2)", fontSize: 11, fontWeight: 600, padding: "4px 9px", borderRadius: 999 }}>
                    <Icon name={SKILLS[id as keyof typeof SKILLS].icon} size={12} />
                    {SKILLS[id as keyof typeof SKILLS].label} · {level}
                  </span>
                ))}
              </div>
            </Card>

            <Card pad={14} style={{ background: "var(--idara-tint)", borderColor: "var(--fs-teal)" }}>
              <div style={{ display: "flex", gap: 10 }}>
                <Icon name="shield-check" size={18} color="var(--fs-teal-700)" />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "var(--fg-1)", marginBottom: 4 }}>Idara-gated claims</div>
                  <div style={{ fontSize: 12, color: "var(--fg-3)", lineHeight: 1.45 }}>
                    A shift only shows as claimable if this person is eligible for the site today. Refused claims are logged too.
                  </div>
                </div>
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* ---- the matcher ---- */}
      <Modal
        open={matching !== null}
        onClose={() => setMatching(null)}
        title={matching ? `Who should work ${matching.role} · ${matching.functionName}?` : ""}
        size="lg"
        footer={<Button variant="sec" size="sm" onClick={() => setMatching(null)}>Done</Button>}
      >
        {matching && result && (
          <div>
            <p style={{ margin: "0 0 14px", fontSize: 12.5, color: "var(--fg-3)", lineHeight: 1.5 }}>
              Ranked by skill fit ({WEIGHTS.skill}), role ({WEIGHTS.role}), client preference ({WEIGHTS.client}),
              rating ({WEIGHTS.rating}), fairness ({WEIGHTS.fairness}) and locality ({WEIGHTS.locality}).{" "}
              <strong>Idara eligibility is a gate, not a score.</strong> {seatsLeft(matching)} seats left.
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {result.candidates.map((c, i) => (
                <div key={c.did} style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                    <div style={{ position: "relative" }}>
                      <Avatar name={c.name} size={34} />
                      <span className="fs-tnum" style={{ position: "absolute", bottom: -4, right: -6, background: "var(--ink-900)", color: "#fff", fontSize: 10, fontWeight: 700, padding: "1px 5px", borderRadius: 999 }}>
                        {c.score}
                      </span>
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 13.5, fontWeight: 700, color: "var(--fg-1)" }}>{c.name}</span>
                        <span style={{ fontSize: 11.5, color: "var(--fg-4)" }}>{c.role}</span>
                        {i === 0 && <Badge tone="teal" icon="sparkles">Best fit</Badge>}
                      </div>
                    </div>
                    <Button size="sm" icon="user-plus" onClick={() => assign(matching, c.did, c.name)}>
                      Assign
                    </Button>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {c.reasons.map((r, j) => <ScoreChip key={j} reason={r} />)}
                    {c.notes.map((n, j) => (
                      <span key={`n${j}`} style={{ background: "var(--warning-bg)", color: "var(--warning-fg)", fontSize: 11.5, fontWeight: 600, padding: "4px 9px", borderRadius: 999 }}>
                        {n.detail}
                      </span>
                    ))}
                  </div>
                </div>
              ))}

              {result.excluded.filter((e) => e.kind !== "assigned").length > 0 && (
                <div style={{ borderTop: "1px dashed var(--border)", paddingTop: 12, marginTop: 4 }}>
                  <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", color: "var(--fg-4)", letterSpacing: ".04em", marginBottom: 8 }}>
                    Not eligible — gated, not ranked
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {result.excluded.filter((e) => e.kind !== "assigned").map((e) => (
                      <div key={e.did} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--fg-3)" }}>
                        <Icon name={e.kind === "idara" ? "shield-alert" : "user-x"} size={13} color={e.kind === "idara" ? "var(--danger)" : "var(--fg-4)"} />
                        <b style={{ color: "var(--fg-2)" }}>{e.name}</b>
                        <span>{e.reason}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* ---- Post a shift ---- */}
      <Modal
        open={postOpen}
        onClose={() => setPostOpen(false)}
        title="Post a shift"
        size="md"
        footer={
          <>
            <Button variant="sec" size="sm" onClick={() => setPostOpen(false)}>Cancel</Button>
            <Button size="sm" icon="plus" onClick={submitPosting}>
              {draft.publish ? "Post it" : "Save draft"}
            </Button>
          </>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {draftErrors.length > 0 && (
            <div style={{ background: "var(--danger-bg)", color: "var(--danger-fg)", borderRadius: 10, padding: "10px 12px", fontSize: 12.5 }}>
              {draftErrors.map((e) => (
                <div key={e} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <Icon name="triangle-alert" size={13} />
                  {e}
                </div>
              ))}
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12 }}>
            <Field label="Role">
              <Select
                value={draft.role}
                onChange={setRole}
                options={Object.keys(ROLE_FUNCTIONS).map((r) => ({ label: r, value: r }))}
                placeholder="Pick a role"
              />
            </Field>
            <Field label="Seats">
              <TextField
                value={draft.seats}
                onChange={(v) => setDraft((d) => ({ ...d, seats: v }))}
                placeholder="1"
                icon="users"
              />
            </Field>
          </div>

          <Field label="Event or function">
            <TextField
              value={draft.functionName}
              onChange={(v) => setDraft((d) => ({ ...d, functionName: v }))}
              placeholder="e.g. Brightwater Friday Live"
              icon="calendar"
            />
          </Field>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Reference" hint="Optional — in-house shifts have none.">
              <TextField
                value={draft.functionRef}
                onChange={(v) => setDraft((d) => ({ ...d, functionRef: v }))}
                placeholder="e.g. FN-2038"
                icon="hash"
              />
            </Field>
            <Field label="Client" hint="Leave blank for in-house work.">
              <TextField
                value={draft.client}
                onChange={(v) => setDraft((d) => ({ ...d, client: v }))}
                placeholder="e.g. Meridian Group"
                icon="briefcase"
              />
            </Field>
          </div>

          <Field label="Site" hint="Decides which credentials the shift is gated on.">
            <Select
              value={draft.siteId}
              onChange={(v) => setDraft((d) => ({ ...d, siteId: v }))}
              options={sites.map((s) => ({ label: `${s.name} · ${s.region}`, value: s.id }))}
              placeholder="Pick a venue or catering site"
            />
          </Field>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Day">
              <TextField
                value={draft.day}
                onChange={(v) => setDraft((d) => ({ ...d, day: v }))}
                placeholder="e.g. Fri, 17 May"
                icon="calendar"
              />
            </Field>
            <Field label="Window">
              <TextField
                value={draft.window}
                onChange={(v) => setDraft((d) => ({ ...d, window: v }))}
                placeholder="e.g. 17:00–01:00"
                icon="clock"
              />
            </Field>
          </div>

          <Field
            label="Duties on this shift"
            hint="Prefilled from the role, and editable — the same person does different regulated work on different nights. This is what the shift is gated on."
          >
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", paddingTop: 2 }}>
              {ALL_WORK_FUNCTIONS.map((fn) => {
                const on = draft.duties.includes(fn);
                return (
                  <button
                    key={fn}
                    type="button"
                    onClick={() => toggleDuty(fn)}
                    style={{
                      font: "inherit",
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: "pointer",
                      padding: "6px 11px",
                      borderRadius: 999,
                      border: `1px solid ${on ? "var(--fs-teal)" : "var(--border-2)"}`,
                      background: on ? "var(--fs-teal-tint)" : "transparent",
                      color: on ? "var(--fs-teal-700)" : "var(--fg-3)",
                    }}
                  >
                    {on && "✓ "}
                    {DUTY_LABEL[fn]}
                  </button>
                );
              })}
            </div>
          </Field>

          <Field
            label="Skills wanted"
            hint="Scored, never gated — a missing skill costs points, it does not block. Leave a skill unset if it does not matter for this shift."
          >
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, paddingTop: 2 }}>
              {(Object.keys(SKILLS) as SkillId[]).map((s) => (
                <div key={s} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ flex: 1, fontSize: 12.5, color: "var(--fg-2)" }}>
                    {SKILLS[s].label}
                  </span>
                  <div style={{ width: 104 }}>
                    <Select
                      value={draft.requires.find((r) => r.skill === s)?.level ?? ""}
                      onChange={(v) => setSkill(s, v)}
                      options={[
                        { label: "—", value: "" },
                        { label: "Basic", value: "basic" },
                        { label: "Solid", value: "solid" },
                        { label: "Lead", value: "lead" },
                      ]}
                    />
                  </div>
                </div>
              ))}
            </div>
          </Field>

          <Field label="Publish">
            <Select
              value={draft.publish ? "open" : "draft"}
              onChange={(v) => setDraft((d) => ({ ...d, publish: v === "open" }))}
              options={[
                { label: "Post it to the board now", value: "open" },
                { label: "Keep as a draft", value: "draft" },
              ]}
            />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
