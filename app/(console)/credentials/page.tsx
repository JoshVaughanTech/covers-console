"use client";

import { useMemo, useState } from "react";
import {
  Card,
  Bar,
  Avatar,
  Badge,
  Button,
  Icon,
  STATUS,
  Modal,
  Field,
  TextField,
  Select,
  Pagination,
  useToast,
} from "@/components/ui";
import type { Tone } from "@/lib/status";
import { CardHead, LinkBtn } from "@/components/screen/page-head";
import {
  useIdara,
  LocalCredentialVerifier,
  CREDENTIAL_TYPES,
  calendarDate,
  standingOf,
  type Credential,
  type CredentialVerifier,
  type Identity,
  type ISODate,
} from "@/lib/idara";

/* ---- Types ----

   Everything on this screen is derived from the same credentials the
   engine gates on. It used to be a separate mock with invented staff, which
   meant a manager could read here that a licence was fine while the matcher
   two screens away refused the person for that exact licence. Two views of
   one fact, able to disagree — so there is now only one fact.

   What this screen deliberately does NOT say is whether somebody is eligible
   to work. Eligibility needs a site: an RSA is demanded of whoever serves
   alcohol, an induction is per-venue, and a Food Safety Supervisor is owed by
   the roster rather than the person. Those questions belong to Schedule and
   Open Shifts, which know which site they are asking about. This screen
   answers the narrower one it can answer alone: what does this person hold,
   and what state is it in. */

/** Credential state as this screen reports it — about the document, not a shift. */
type CredState = "Current" | "Expiring" | "Expired" | "Revoked" | "Suspended";

/** Worst state across somebody's credentials, which is what the row shows. */
type RowState = "Current" | "Expiring" | "Action needed";
type Filter = "All" | RowState;

interface CredRow {
  id: string;
  label: string;
  /** who issued it, and the certificate number where one is recorded */
  line1: string;
  /** expiry, or the site it is scoped to */
  line2: string;
  icon: string;
  state: CredState;
  tone: Tone;
}

interface Row {
  did: string;
  name: string;
  role: string;
  state: RowState;
  tone: Tone;
  /** what is wrong, in the manager's words rather than the engine's */
  issues: string;
  creds: CredRow[];
}

interface JobState {
  name: string;
  site: string;
  date: string;
  time: string;
}

const PAGE_SIZE = 5;


function fmtDay(iso: ISODate): string {
  const [y, m, d] = calendarDate(iso).split("-");
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
}

const CRED_TONE: Record<CredState, Tone> = {
  Current: "success",
  Expiring: "warning",
  Expired: "danger",
  Revoked: "danger",
  Suspended: "warning",
};

/**
 * One person's credentials, as held and as verified today.
 *
 * The verifier decides revoked, suspended and expired; the warning window is
 * the engine's own EXPIRY_WARN_DAYS, so a credential shown amber here is the
 * same one the matcher notes against a candidate.
 */
function credRowsFor(
  did: string,
  all: Credential[],
  at: ISODate,
  verifier: CredentialVerifier,
  siteName: (id: string) => string,
): CredRow[] {
  /* The states come from standingOf() rather than being recomputed here, so
     this screen and People cannot disagree about whether a licence is good.
     Everything below this line is presentation. */
  return standingOf(did, all, at, verifier)
    .held.map(({ credential: c, state, daysLeft }): CredRow => {
      const meta = CREDENTIAL_TYPES[c.type];
      const label: CredState =
        state === "current" ? "Current"
        : state === "expiring" ? "Expiring"
        : state === "expired" ? "Expired"
        : state === "revoked" ? "Revoked"
        : "Suspended";

      const soon =
        label === "Expiring" && daysLeft !== null
          ? " · " + daysLeft + " day" + (daysLeft === 1 ? "" : "s")
          : "";
      let line2 = !c.expiresAt
        ? "No expiry"
        : label === "Expired"
          ? "Expired " + fmtDay(c.expiresAt)
          : "Expires " + fmtDay(c.expiresAt) + soon;
      // a site-scoped credential is only meaningful with the site named
      if (c.claims.siteId) line2 = siteName(c.claims.siteId) + " · " + line2;

      return {
        id: c.id,
        label: meta.label,
        line1: meta.authority + (c.claims.cert ? " · " + c.claims.cert : ""),
        line2,
        icon: meta.icon,
        state: label,
        tone: CRED_TONE[label],
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** The row for one person: worst state wins, and the issue names itself. */
function rowFor(person: Identity, creds: CredRow[]): Row {
  const bad = creds.filter((c) => c.state === "Expired" || c.state === "Revoked" || c.state === "Suspended");
  const soon = creds.filter((c) => c.state === "Expiring");

  const state: RowState = bad.length ? "Action needed" : soon.length ? "Expiring" : "Current";
  const issues = bad.length
    ? bad.map((c) => `${c.label} ${c.state.toLowerCase()}`).join(" · ")
    : soon.length
      ? soon.map((c) => `${c.label} expiring`).join(" · ")
      : "—";

  return {
    did: person.did,
    name: person.name,
    role: person.role,
    state,
    tone: state === "Current" ? "success" : state === "Expiring" ? "warning" : "danger",
    issues,
    creds,
  };
}

export default function CredentialsPage() {
  const toast = useToast();

  const { workers: staff, credentials, sites, today, auditLog } = useIdara();
  const verifier = useMemo(() => new LocalCredentialVerifier(), []);

  const siteName = useMemo(() => {
    const byId = new Map(sites.map((s) => [s.id, s.name]));
    return (id: string) => byId.get(id) ?? id;
  }, [sites]);

  /* The rows are derived, never held. A credential revoked elsewhere in the
     console changes this screen on the next render rather than after a
     refresh, because there is nothing here to go stale. */
  const workers = useMemo(
    () =>
      staff.map((person) =>
        rowFor(person, credRowsFor(person.did, credentials, today, verifier, siteName)),
      ),
    [staff, credentials, today, verifier, siteName],
  );

  const [filter, setFilter] = useState<Filter>("All");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string>(staff[0]?.did ?? "");
  const [checking, setChecking] = useState(false);

  const [job, setJob] = useState<JobState>({
    name: "Brightwater Friday Live",
    site: "Brightwater Hotel, Fitzroy",
    date: "Thu, 16 May 2024",
    time: "3:00pm – 12:00am (9h)",
  });

  const [editOpen, setEditOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);

  // Draft job state for the edit modal
  const [draft, setDraft] = useState<JobState>(job);

  /* ---- Derived ---- */
  const counts = useMemo(() => {
    const c: Record<Filter, number> = { All: workers.length, Current: 0, Expiring: 0, "Action needed": 0 };
    for (const w of workers) c[w.state] += 1;
    return c;
  }, [workers]);

  const filtered = useMemo(
    () => (filter === "All" ? workers : workers.filter((w) => w.state === filter)),
    [workers, filter]
  );

  const pageStart = (page - 1) * PAGE_SIZE;
  const pageWorkers = filtered.slice(pageStart, pageStart + PAGE_SIZE);

  const selected = useMemo(
    () => workers.find((w) => w.did === selectedId) ?? workers[0],
    [workers, selectedId]
  );
  const selectedCreds = selected?.creds ?? [];

  /* The event log is the audit chain, filtered to what this screen is about,
     newest first. It used to be eight invented lines that never changed;
     now a revocation performed here appears here, because it is the same
     record the Audit Log screen renders and the matcher reads. */
  const log = useMemo(
    () =>
      auditLog
        .filter((e) => e.type.startsWith("credential."))
        .slice()
        .reverse()
        .map((e) => ({
          id: e.id,
          title: e.type === "credential.revoked" ? "Credential revoked" : "Credential issued",
          detail: e.summary,
          at: fmtDay(e.at),
          icon: e.type === "credential.revoked" ? "shield-off" : "badge-check",
          tone: (e.type === "credential.revoked" ? "danger" : "success") as Tone,
        })),
    [auditLog],
  );
  const FILTERS: Filter[] = ["All", "Current", "Expiring", "Action needed"];

  /* ---- Handlers ---- */
  function applyFilter(f: Filter) {
    setFilter(f);
    setPage(1);
  }

  function selectWorker(id: string) {
    setSelectedId(id);
  }

  /* There is nothing to recompute. Every row on this screen is derived from
     the credentials on each render, so the answer is already current — which
     is the point of deriving rather than storing. The button reports what is
     true instead of pretending to do work, and says what it counted so the
     number can be checked against the list underneath it. */
  function checkEligibility() {
    if (checking) return;
    setChecking(true);
    setTimeout(() => {
      setChecking(false);
      const held = workers.reduce((n, w) => n + w.creds.length, 0);
      const wrong = counts["Action needed"] + counts.Expiring;
      toast(
        `${held} credentials verified across ${workers.length} staff · ${wrong} need attention`,
        { tone: wrong ? "warning" : "success", icon: "scan-search" },
      );
    }, 400);
  }

  function openEdit() {
    setDraft(job);
    setEditOpen(true);
  }

  function saveJob() {
    setJob(draft);
    setEditOpen(false);
    toast("Job details updated", { tone: "success", icon: "check" });
  }

  const verifiedIdentity = selected?.state !== "Action needed";

  /* Coverage per credential type, counted rather than asserted: how many of
     the staff hold this one in a state the verifier still accepts. A venue
     asks this before it asks about any individual — "can we open the gaming
     room tonight" is a question about how many RSGs are current. */
  const coverage = useMemo(
    () =>
      (Object.keys(CREDENTIAL_TYPES) as (keyof typeof CREDENTIAL_TYPES)[]).map((type) => {
        const meta = CREDENTIAL_TYPES[type];
        const held = workers.filter((w) =>
          w.creds.some((c) => c.label === meta.label && (c.state === "Current" || c.state === "Expiring")),
        ).length;
        return { label: meta.shortLabel, icon: meta.icon, held };
      }),
    [workers],
  );

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
          <img src="/assets/idara-icon-t.png" alt="idara" style={{ width: 18, height: 18 }} />
          <span style={{ fontWeight: 800, fontSize: 17, color: "var(--fg-1)" }}>Idara Verify</span>
        </span>
        <Icon name="chevron-right" size={15} color="var(--fg-4)" />
        <span style={{ fontSize: 15, color: "var(--fg-3)", fontWeight: 600 }}>Credentials &amp; Eligibility</span>
      </div>
      <p style={{ margin: "0 0 18px", fontSize: 14 }}>Real-time verification and roster eligibility for the right person, every shift.</p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 16, alignItems: "start" }}>
        <div>
          {/* job header */}
          <Card style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16 }}>
            <span style={{ width: 46, height: 46, borderRadius: 11, background: "var(--fs-teal-tint)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}><Icon name="building-2" size={22} color="var(--fs-teal-700)" /></span>
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 9 }}><span style={{ fontSize: 16, fontWeight: 700, color: "var(--fg-1)" }}>{job.name}</span><Badge tone="success" dot>Active</Badge></div>
              <div style={{ fontSize: 12.5, color: "var(--fg-3)", marginTop: 2 }}>{job.site} · {job.date} · {job.time}</div>
            </div>
            <Button variant="sec" size="sm" onClick={openEdit}>Edit Shift</Button>
            <Button size="sm" icon={checking ? "loader" : "scan-search"} onClick={checkEligibility}>{checking ? "Checking…" : "Check Eligibility"}</Button>
          </Card>
          {/* job requirements */}
          <Card style={{ marginBottom: 16 }}>
            <CardHead title="Credential coverage" right={<span style={{ fontSize: 11.5, color: "var(--fg-4)", display: "inline-flex", alignItems: "center", gap: 5 }}><Icon name="users" size={13} />{workers.length} staff</span>} />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10 }}>
              {coverage.map((c) => {
                const pct = workers.length ? (c.held / workers.length) * 100 : 0;
                const tone: Tone = pct === 100 ? "success" : pct >= 50 ? "warning" : "danger";
                const [, , dc] = STATUS[tone];
                return (
                  <div key={c.label} style={{ border: "1px solid var(--border)", borderRadius: 11, padding: 12, display: "flex", flexDirection: "column", gap: 7 }}>
                    <Icon name={c.icon} size={18} color="var(--fs-teal)" />
                    <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--fg-2)", lineHeight: 1.25 }}>{c.label}<div style={{ fontSize: 10, color: "var(--fg-4)", fontWeight: 500 }}>Currently held</div></div>
                    <div className="fs-tnum" style={{ fontSize: 16, fontWeight: 800, color: "var(--fg-1)" }}>{c.held}<span style={{ fontSize: 12, color: "var(--fg-4)", fontWeight: 600 }}> / {workers.length}</span></div>
                    <Bar value={pct} color={dc} height={4} />
                  </div>
                );
              })}
            </div>
          </Card>
          {/* roster eligibility */}
          <Card pad={0}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
              <h4 style={{ margin: 0, fontSize: 15.5 }}>Roster Eligibility</h4>
              <div style={{ flex: 1 }} />
              {FILTERS.map((f) => {
                const active = filter === f;
                return (
                  <button
                    key={f}
                    type="button"
                    onClick={() => applyFilter(f)}
                    style={{
                      font: "inherit",
                      fontSize: 12.5,
                      fontWeight: 600,
                      cursor: "pointer",
                      color: active ? "var(--fs-teal)" : "var(--fg-3)",
                      display: "inline-flex",
                      gap: 5,
                      padding: "4px 9px",
                      borderRadius: 7,
                      border: 0,
                      background: active ? "var(--fs-teal-tint)" : "transparent",
                    }}
                  >
                    {f} <span className="fs-tnum" style={{ color: "var(--fg-4)" }}>{counts[f]}</span>
                  </button>
                );
              })}
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead>
                <tr>
                  {["Staff", "Status", "Held", "Needs attention"].map((h) => (
                    <th key={h} style={{ textAlign: "left", padding: "9px 14px", fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--fg-4)" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pageWorkers.length === 0 ? (
                  <tr style={{ borderTop: "1px solid var(--border)" }}>
                    <td colSpan={4} style={{ padding: "28px 14px", textAlign: "center", color: "var(--fg-4)", fontSize: 13 }}>No workers match this filter.</td>
                  </tr>
                ) : (
                  pageWorkers.map((w) => {
                    const isSel = w.did === selected?.did;
                    return (
                      <tr
                        key={w.did}
                        className="hov-row"
                        onClick={() => selectWorker(w.did)}
                        style={{
                          borderTop: "1px solid var(--border)",
                          cursor: "pointer",
                          background: isSel ? "var(--fs-teal-tint)" : undefined,
                          boxShadow: isSel ? "inset 3px 0 0 var(--fs-teal)" : undefined,
                        }}
                      >
                        <td style={{ padding: "11px 14px" }}><div style={{ display: "flex", alignItems: "center", gap: 9 }}><Avatar name={w.name} size={28} /><span><div style={{ fontWeight: 600, color: "var(--fg-1)" }}>{w.name}</div><div style={{ fontSize: 10.5, color: "var(--fg-4)" }}>{w.role}</div></span></div></td>
                        <td style={{ padding: "11px 14px" }}><Badge tone={w.tone} dot>{w.state}</Badge></td>
                        <td className="fs-tnum" style={{ padding: "11px 14px", color: "var(--fg-2)" }}>{w.creds.length}</td>
                        <td style={{ padding: "11px 14px", color: w.issues === "—" ? "var(--fg-4)" : w.state === "Action needed" ? "var(--danger-fg)" : "var(--warning-fg)", fontSize: 12, maxWidth: 260 }}>{w.issues}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
            <div style={{ padding: "12px 16px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, color: "var(--fg-4)" }}>
              <span>
                {filtered.length === 0
                  ? "Showing 0 workers"
                  : `Showing ${pageStart + 1} to ${Math.min(pageStart + PAGE_SIZE, filtered.length)} of ${filtered.length} workers`}
              </span>
              <Pagination page={page} total={filtered.length} pageSize={PAGE_SIZE} onChange={setPage} />
            </div>
          </Card>
        </div>
        {/* worker verification panel */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Card>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>Staff Verification</div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
              <Avatar name={selected.name} size={46} />
              <div><div style={{ fontSize: 15, fontWeight: 700, color: "var(--fg-1)" }}>{selected.name}</div><div className="fs-tnum" style={{ fontSize: 11.5, color: "var(--fg-4)" }}>{selected?.role}</div></div>
            </div>
            {verifiedIdentity ? (
              <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "8px 11px", background: "var(--success-bg)", borderRadius: 9, marginBottom: 14 }}>
                <Icon name="badge-check" size={16} color="var(--success-fg)" /><span style={{ fontSize: 12, fontWeight: 700, color: "var(--success-fg)" }}>ALL CREDENTIALS CURRENT</span>
                <span style={{ marginLeft: "auto", fontSize: 10.5, color: "var(--success-fg)", opacity: 0.8 }}>as at {fmtDay(today)}</span>
              </div>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "8px 11px", background: "var(--danger-bg)", borderRadius: 9, marginBottom: 14 }}>
                <Icon name="shield-alert" size={16} color="var(--danger-fg)" /><span style={{ fontSize: 12, fontWeight: 700, color: "var(--danger-fg)" }}>CREDENTIALS NEED ATTENTION</span>
                <span style={{ marginLeft: "auto", fontSize: 10.5, color: "var(--danger-fg)", opacity: 0.8 }}>as at {fmtDay(today)}</span>
              </div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
              {selectedCreds.map((c, i) => {
                const ok = c.state === "Current";
                return (
                  <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                    <span style={{ width: 30, height: 30, borderRadius: 8, background: "var(--bg-2)", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Icon name={c.icon} size={15} color={ok ? "var(--fs-teal)" : "var(--fg-4)"} /></span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--fg-1)" }}>{c.label}</div>
                      <div style={{ fontSize: 11, color: "var(--fg-4)" }}>{c.line1}{c.line2 && <> · {c.line2}</>}</div>
                    </div>
                    <Badge tone={c.tone} icon={ok ? "check" : "alert-triangle"}>{c.state}</Badge>
                  </div>
                );
              })}
            </div>
            <Button variant="sec" size="sm" iconRight="external-link" style={{ width: "100%", marginTop: 14 }} onClick={() => setProfileOpen(true)}>View Full Profile</Button>
          </Card>
          <Card>
            <CardHead title="Event Log" right={<LinkBtn onClick={() => setLogOpen(true)}>View all</LinkBtn>} />
            <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
              {log.slice(0, 5).map((e, i) => {
                const [bg, fg] = STATUS[e.tone];
                return (
                  <div key={i} style={{ display: "flex", gap: 10, padding: "9px 0", borderTop: i ? "1px solid var(--border)" : 0 }}>
                    <span style={{ width: 26, height: 26, borderRadius: 7, background: bg, color: fg, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Icon name={e.icon} size={14} /></span>
                    <div style={{ flex: 1 }}><div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--fg-1)" }}>{e.title}</div><div style={{ fontSize: 11, color: "var(--fg-4)" }}>{e.detail}</div></div>
                    <span style={{ fontSize: 10.5, color: "var(--fg-4)", whiteSpace: "nowrap" }}>{e.at}</span>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>
      </div>

      {/* ---- Edit Shift modal ---- */}
      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="Edit Shift"
        size="sm"
        footer={
          <>
            <Button variant="sec" size="sm" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button size="sm" icon="check" onClick={saveJob}>Save</Button>
          </>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Field label="Job name">
            <TextField value={draft.name} onChange={(v) => setDraft((d) => ({ ...d, name: v }))} placeholder="Job name" icon="briefcase" />
          </Field>
          <Field label="Site">
            <Select
              value={draft.site}
              onChange={(v) => setDraft((d) => ({ ...d, site: v }))}
              options={[
                { label: "Brightwater Hotel, Fitzroy", value: "Brightwater Hotel, Fitzroy" },
                { label: "Brightwater Gaming Room, Fitzroy", value: "Brightwater Gaming Room, Fitzroy" },
                { label: "Northside Tavern, Brunswick", value: "Northside Tavern, Brunswick" },
                { label: "Werribee Park Wedding (off-premise)", value: "Werribee Park Wedding (off-premise)" },
              ]}
              placeholder="Select a venue or site"
            />
          </Field>
          <Field label="Date">
            <TextField value={draft.date} onChange={(v) => setDraft((d) => ({ ...d, date: v }))} placeholder="e.g. Thu, 16 May 2024" icon="calendar" />
          </Field>
          <Field label="Time" hint="Shift window and total hours.">
            <TextField value={draft.time} onChange={(v) => setDraft((d) => ({ ...d, time: v }))} placeholder="e.g. 7:00am – 3:30pm (8.5h)" icon="clock" />
          </Field>
        </div>
      </Modal>

      {/* ---- View Full Profile modal ---- */}
      <Modal
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
        title="Worker Profile"
        size="md"
        footer={<Button size="sm" variant="sec" onClick={() => setProfileOpen(false)}>Close</Button>}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16 }}>
          <Avatar name={selected.name} size={54} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: "var(--fg-1)" }}>{selected.name}</div>
            <div style={{ fontSize: 12, color: "var(--fg-4)" }}>{selected?.role}</div>
          </div>
          <Badge tone={selected.tone} dot>{selected.state}</Badge>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 18 }}>
          {[
            ["Credentials held", String(selected.creds.length), "badge-check"],
            ["Needs attention", String(selected.creds.filter((c) => c.state !== "Current").length), "triangle-alert"],
            ["Inductions", String(selected.creds.filter((c) => c.label.includes("Induction")).length), "map-pin-check"],
          ].map(([label, value, icon]) => (
            <div key={label} style={{ border: "1px solid var(--border)", borderRadius: 11, padding: 12 }}>
              <Icon name={icon} size={16} color="var(--fs-teal)" />
              <div style={{ fontSize: 11, color: "var(--fg-4)", marginTop: 6 }}>{label}</div>
              <div className="fs-tnum" style={{ fontSize: 15, fontWeight: 700, color: "var(--fg-1)" }}>{value}</div>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--fg-2)", marginBottom: 10 }}>Credentials</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
          {selectedCreds.map((c, i) => {
            const ok = c.state === "Current";
            return (
              <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                <span style={{ width: 30, height: 30, borderRadius: 8, background: "var(--bg-2)", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Icon name={c.icon} size={15} color={ok ? "var(--fs-teal)" : "var(--fg-4)"} /></span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--fg-1)" }}>{c.label}</div>
                  <div style={{ fontSize: 11, color: "var(--fg-4)" }}>{c.line1}{c.line2 && <> · {c.line2}</>}</div>
                </div>
                <Badge tone={c.tone} icon={ok ? "check" : "alert-triangle"}>{c.state}</Badge>
              </div>
            );
          })}
        </div>
      </Modal>

      {/* ---- Event Log (View all) modal ---- */}
      <Modal
        open={logOpen}
        onClose={() => setLogOpen(false)}
        title="Event Log"
        size="md"
        footer={<Button size="sm" variant="sec" onClick={() => setLogOpen(false)}>Close</Button>}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
          {log.map((e, i) => {
            const [bg, fg] = STATUS[e.tone];
            return (
              <div key={i} style={{ display: "flex", gap: 10, padding: "11px 0", borderTop: i ? "1px solid var(--border)" : 0 }}>
                <span style={{ width: 28, height: 28, borderRadius: 7, background: bg, color: fg, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Icon name={e.icon} size={15} /></span>
                <div style={{ flex: 1 }}><div style={{ fontSize: 13, fontWeight: 600, color: "var(--fg-1)" }}>{e.title}</div><div style={{ fontSize: 11.5, color: "var(--fg-4)" }}>{e.detail}</div></div>
                <span style={{ fontSize: 11, color: "var(--fg-4)", whiteSpace: "nowrap" }}>{e.at}</span>
              </div>
            );
          })}
        </div>
      </Modal>
    </div>
  );
}
