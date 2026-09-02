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

/* ---- Types ---- */
type WStatus = "Eligible" | "Warning" | "Blocked";
type Filter = "All" | WStatus;

interface Worker {
  id: string;
  name: string;
  cardId: string;
  status: WStatus;
  tone: Tone;
  match: number;
  issues: string;
  fatigue: "Fit" | "At Risk";
  access: "Approved" | "Pending" | "—";
}

interface Cred {
  name: string;
  line1: string;
  line2: string;
  icon: string;
  state: string;
  verified: boolean;
}

interface JobState {
  name: string;
  site: string;
  date: string;
  time: string;
}

/* ---- Seed data ---- */
const WORKERS: Worker[] = [
  { id: "w1", name: "Daniel Roberts", cardId: "9587 4632 7876", status: "Eligible", tone: "success", match: 100, issues: "—", fatigue: "Fit", access: "Approved" },
  { id: "w2", name: "Sarah Thompson", cardId: "6738 2910 4421", status: "Warning", tone: "warning", match: 83, issues: "Venue Induction missing", fatigue: "Fit", access: "Approved" },
  { id: "w3", name: "Michael Chen", cardId: "2846 9011 7783", status: "Blocked", tone: "danger", match: 50, issues: "Food Handling expired", fatigue: "Fit", access: "—" },
  { id: "w4", name: "Priya Nair", cardId: "5590 3312 6679", status: "Warning", tone: "warning", match: 67, issues: "RSG expiring · Venue Induction missing", fatigue: "Fit", access: "Pending" },
  { id: "w5", name: "James Walker", cardId: "1123 5566 8890", status: "Blocked", tone: "danger", match: 40, issues: "Fatigue risk – review", fatigue: "At Risk", access: "Approved" },
  { id: "w6", name: "Emily Davies", cardId: "4471 8820 1190", status: "Eligible", tone: "success", match: 96, issues: "—", fatigue: "Fit", access: "Approved" },
  { id: "w7", name: "Lucas Martin", cardId: "3389 7745 2210", status: "Eligible", tone: "success", match: 92, issues: "—", fatigue: "Fit", access: "Approved" },
  { id: "w8", name: "Aisha Khan", cardId: "7712 0093 5567", status: "Warning", tone: "warning", match: 71, issues: "First Aid expiring", fatigue: "Fit", access: "Pending" },
  { id: "w9", name: "Tom Nguyen", cardId: "6650 2218 9034", status: "Eligible", tone: "success", match: 98, issues: "—", fatigue: "Fit", access: "Approved" },
  { id: "w10", name: "Grace O'Brien", cardId: "2204 5561 7789", status: "Blocked", tone: "danger", match: 45, issues: "RSA expired", fatigue: "Fit", access: "—" },
  { id: "w11", name: "Noah Patel", cardId: "8891 3320 4456", status: "Eligible", tone: "success", match: 94, issues: "—", fatigue: "Fit", access: "Approved" },
  { id: "w12", name: "Olivia Reed", cardId: "1147 6690 2238", status: "Warning", tone: "warning", match: 78, issues: "Venue Induction missing", fatigue: "At Risk", access: "Pending" },
  { id: "w13", name: "Ethan Brooks", cardId: "5523 1108 7790", status: "Eligible", tone: "success", match: 90, issues: "—", fatigue: "Fit", access: "Approved" },
  { id: "w14", name: "Mia Foster", cardId: "9930 4471 2215", status: "Blocked", tone: "danger", match: 38, issues: "RSG revoked", fatigue: "At Risk", access: "—" },
];

const REQS: [string, number, string, Tone][] = [
  ["Food Handling", 32, "utensils", "warning"],
  ["First Aid", 34, "plus-square", "warning"],
  ["RSA", 36, "id-card", "success"],
  ["Venue Induction", 31, "clipboard-list", "warning"],
  ["RSG", 28, "dice-5", "danger"],
  ["Fatigue Status", 33, "battery-medium", "warning"],
];

const LOG: [string, string, string, Tone][] = [
  ["Credential verified", "Food Handling", "shield-check", "success"],
  ["Gaming access granted", "Brightwater Gaming Room", "dice-5", "success"],
  ["Shift acknowledged", "Brightwater Friday Live", "check-circle-2", "info"],
  ["Venue induction verified", "Brightwater Hotel", "clipboard-check", "success"],
  ["Fatigue status updated", "Fit for Duty", "battery-medium", "success"],
  ["Eligibility check run", "36 staff scanned", "scan-search", "info"],
  ["Credential expiring soon", "First Aid · Aisha Khan", "alarm-clock", "warning"],
  ["RSG revoked", "Mia Foster", "dice-5", "danger"],
];

const PAGE_SIZE = 5;

/* ---- Per-worker credential derivation ---- */
function credsFor(w: Worker): Cred[] {
  const base: Cred[] = [
    { name: "Food Handling", line1: "VIC · FH-0012345", line2: "Expires 12 May 2026", icon: "utensils", state: "Verified", verified: true },
    { name: "First Aid (HLTAID011)", line1: "Expires 20 Oct 2025", line2: "", icon: "plus-square", state: "Verified", verified: true },
    { name: "RSA (SITHFAB021)", line1: "Expires 14 Aug 2026", line2: "", icon: "wine", state: "Verified", verified: true },
    { name: "Venue Induction", line1: "Brightwater Hotel – Fitzroy", line2: "Completed 2 May 2024", icon: "map-pin-check", state: "Verified", verified: true },
    { name: "RSG", line1: "VGCCC · RSG-448120", line2: "Expires 30 May 2025", icon: "dice-5", state: "Approved", verified: true },
    { name: "Fatigue Status", line1: "Fit for Duty · As at today, 6:15am", line2: "", icon: "battery-medium", state: "Fit", verified: true },
  ];
  const out = base.map((c) => ({ ...c }));
  const flag = (name: string, state: string, line2?: string) => {
    const c = out.find((x) => x.name.startsWith(name));
    if (c) {
      c.verified = false;
      c.state = state;
      if (line2 !== undefined) c.line2 = line2;
    }
  };
  if (w.fatigue === "At Risk") flag("Fatigue Status", "At Risk", "Review required · today, 6:15am");
  if (w.access === "Pending") flag("RSG", "Pending");
  if (w.access === "—") flag("RSG", "Not Granted");

  if (w.issues.includes("Food Handling")) flag("Food Handling", "Expired", "Expired 4 Apr 2024");
  if (w.issues.includes("RSA")) flag("RSA", "Expired", "");
  if (w.issues.includes("First Aid")) flag("First Aid", "Expiring", "");
  if (w.issues.includes("Venue Induction")) flag("Venue Induction", "Missing", "Not completed");
  if (w.issues.includes("Access Approval expiring")) flag("RSG", "Expiring");
  if (w.issues.includes("RSG revoked")) flag("RSG", "Revoked", "Revoked 1 May 2024");
  return out;
}

export default function CredentialsPage() {
  const toast = useToast();

  const [workers, setWorkers] = useState<Worker[]>(WORKERS);
  const [filter, setFilter] = useState<Filter>("All");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string>(WORKERS[0].id);
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
    const c = { All: workers.length, Eligible: 0, Warning: 0, Blocked: 0 };
    for (const w of workers) c[w.status] += 1;
    return c;
  }, [workers]);

  const filtered = useMemo(
    () => (filter === "All" ? workers : workers.filter((w) => w.status === filter)),
    [workers, filter]
  );

  const pageStart = (page - 1) * PAGE_SIZE;
  const pageWorkers = filtered.slice(pageStart, pageStart + PAGE_SIZE);

  const selected = useMemo(
    () => workers.find((w) => w.id === selectedId) ?? workers[0],
    [workers, selectedId]
  );
  const selectedCreds = useMemo(() => credsFor(selected), [selected]);

  const FILTERS: Filter[] = ["All", "Eligible", "Warning", "Blocked"];

  /* ---- Handlers ---- */
  function applyFilter(f: Filter) {
    setFilter(f);
    setPage(1);
  }

  function selectWorker(id: string) {
    setSelectedId(id);
  }

  function checkEligibility() {
    if (checking) return;
    setChecking(true);
    setTimeout(() => {
      // Recompute match scores with a tiny mock variance to show a live effect.
      setWorkers((prev) =>
        prev.map((w) => {
          if (w.status === "Eligible") {
            return { ...w, match: Math.min(100, Math.max(90, w.match + ((w.match * 7) % 5) - 2)) };
          }
          return w;
        })
      );
      setChecking(false);
      toast("Eligibility re-checked · 36 workers scanned", { tone: "success", icon: "scan-search" });
    }, 1100);
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

  const verifiedIdentity = selected.status !== "Blocked";

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
            <CardHead title="Shift Requirements" right={<span style={{ fontSize: 11.5, color: "var(--fg-4)", display: "inline-flex", alignItems: "center", gap: 5 }}><Icon name="refresh-cw" size={13} />Last updated: 2 mins ago</span>} />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(6,1fr)", gap: 10 }}>
              {REQS.map(([n, v, icon, tone], i) => {
                const [, , dc] = STATUS[tone];
                return (
                  <div key={i} style={{ border: "1px solid var(--border)", borderRadius: 11, padding: 12, display: "flex", flexDirection: "column", gap: 7 }}>
                    <Icon name={icon} size={18} color="var(--fs-teal)" />
                    <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--fg-2)", lineHeight: 1.25 }}>{n}<div style={{ fontSize: 10, color: "var(--fg-4)", fontWeight: 500 }}>Required</div></div>
                    <div className="fs-tnum" style={{ fontSize: 16, fontWeight: 800, color: "var(--fg-1)" }}>{v}<span style={{ fontSize: 12, color: "var(--fg-4)", fontWeight: 600 }}> / 36</span></div>
                    <Bar value={(v / 36) * 100} color={dc} height={4} />
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
                  {["Staff", "Status", "Match", "Missing / Issues", "Fatigue", "Gaming"].map((h) => (
                    <th key={h} style={{ textAlign: "left", padding: "9px 14px", fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--fg-4)" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pageWorkers.length === 0 ? (
                  <tr style={{ borderTop: "1px solid var(--border)" }}>
                    <td colSpan={6} style={{ padding: "28px 14px", textAlign: "center", color: "var(--fg-4)", fontSize: 13 }}>No workers match this filter.</td>
                  </tr>
                ) : (
                  pageWorkers.map((w) => {
                    const isSel = w.id === selected.id;
                    return (
                      <tr
                        key={w.id}
                        className="hov-row"
                        onClick={() => selectWorker(w.id)}
                        style={{
                          borderTop: "1px solid var(--border)",
                          cursor: "pointer",
                          background: isSel ? "var(--fs-teal-tint)" : undefined,
                          boxShadow: isSel ? "inset 3px 0 0 var(--fs-teal)" : undefined,
                        }}
                      >
                        <td style={{ padding: "11px 14px" }}><div style={{ display: "flex", alignItems: "center", gap: 9 }}><Avatar name={w.name} size={28} /><span><div style={{ fontWeight: 600, color: "var(--fg-1)" }}>{w.name}</div><div className="fs-tnum" style={{ fontSize: 10.5, color: "var(--fg-4)" }}>ID: {w.cardId}</div></span></div></td>
                        <td style={{ padding: "11px 14px" }}><Badge tone={w.tone} dot>{w.status}</Badge></td>
                        <td style={{ padding: "11px 14px", minWidth: 90 }}><div className="fs-tnum" style={{ fontSize: 12, fontWeight: 700, color: "var(--fg-1)", marginBottom: 4 }}>{w.match}%</div><Bar value={w.match} color={w.match >= 90 ? "var(--success)" : w.match >= 60 ? "var(--warning)" : "var(--danger)"} height={4} /></td>
                        <td style={{ padding: "11px 14px", color: w.issues === "—" ? "var(--fg-4)" : "var(--warning-fg)", fontSize: 12, maxWidth: 200 }}>{w.issues}</td>
                        <td style={{ padding: "11px 14px" }}>{w.fatigue === "Fit" ? <span style={{ color: "var(--success-fg)", fontWeight: 600, display: "inline-flex", gap: 5, alignItems: "center" }}><span style={{ width: 6, height: 6, borderRadius: 999, background: "var(--success)" }} />Fit</span> : <span style={{ color: "var(--danger-fg)", fontWeight: 600, display: "inline-flex", gap: 5, alignItems: "center" }}><Icon name="triangle-alert" size={13} />At Risk</span>}</td>
                        <td style={{ padding: "11px 14px" }}>{w.access === "—" ? <span style={{ color: "var(--fg-4)" }}>—</span> : <Badge tone={w.access === "Approved" ? "success" : "warning"}>{w.access}</Badge>}</td>
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
              <div><div style={{ fontSize: 15, fontWeight: 700, color: "var(--fg-1)" }}>{selected.name}</div><div className="fs-tnum" style={{ fontSize: 11.5, color: "var(--fg-4)" }}>ID: {selected.cardId}</div></div>
            </div>
            {verifiedIdentity ? (
              <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "8px 11px", background: "var(--success-bg)", borderRadius: 9, marginBottom: 14 }}>
                <Icon name="badge-check" size={16} color="var(--success-fg)" /><span style={{ fontSize: 12, fontWeight: 700, color: "var(--success-fg)" }}>VERIFIED IDENTITY</span>
                <span style={{ marginLeft: "auto", fontSize: 10.5, color: "var(--success-fg)", opacity: 0.8 }}>Today, 6:15am</span>
              </div>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "8px 11px", background: "var(--danger-bg)", borderRadius: 9, marginBottom: 14 }}>
                <Icon name="shield-alert" size={16} color="var(--danger-fg)" /><span style={{ fontSize: 12, fontWeight: 700, color: "var(--danger-fg)" }}>ELIGIBILITY BLOCKED</span>
                <span style={{ marginLeft: "auto", fontSize: 10.5, color: "var(--danger-fg)", opacity: 0.8 }}>Today, 6:15am</span>
              </div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
              {selectedCreds.map((c, i) => {
                const tone: Tone = c.verified ? "success" : c.state === "Pending" || c.state === "Expiring" ? "warning" : "danger";
                return (
                  <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                    <span style={{ width: 30, height: 30, borderRadius: 8, background: "var(--bg-2)", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Icon name={c.icon} size={15} color={c.verified ? "var(--fs-teal)" : "var(--fg-4)"} /></span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--fg-1)" }}>{c.name}</div>
                      <div style={{ fontSize: 11, color: "var(--fg-4)" }}>{c.line1}{c.line2 && <> · {c.line2}</>}</div>
                    </div>
                    <Badge tone={tone} icon={c.verified ? "check" : "alert-triangle"}>{c.state}</Badge>
                  </div>
                );
              })}
            </div>
            <Button variant="sec" size="sm" iconRight="external-link" style={{ width: "100%", marginTop: 14 }} onClick={() => setProfileOpen(true)}>View Full Profile</Button>
          </Card>
          <Card>
            <CardHead title="Event Log" right={<LinkBtn onClick={() => setLogOpen(true)}>View all</LinkBtn>} />
            <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
              {LOG.slice(0, 5).map((e, i) => {
                const [bg, fg] = STATUS[e[3]];
                return (
                  <div key={i} style={{ display: "flex", gap: 10, padding: "9px 0", borderTop: i ? "1px solid var(--border)" : 0 }}>
                    <span style={{ width: 26, height: 26, borderRadius: 7, background: bg, color: fg, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Icon name={e[2]} size={14} /></span>
                    <div style={{ flex: 1 }}><div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--fg-1)" }}>{e[0]}</div><div style={{ fontSize: 11, color: "var(--fg-4)" }}>{e[1]}</div></div>
                    <span style={{ fontSize: 10.5, color: "var(--fg-4)", whiteSpace: "nowrap" }}>Today, 6:15am</span>
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
            <div className="fs-tnum" style={{ fontSize: 12, color: "var(--fg-4)" }}>ID: {selected.cardId}</div>
          </div>
          <Badge tone={selected.tone} dot>{selected.status}</Badge>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 18 }}>
          {[
            ["Match Score", `${selected.match}%`, "target"],
            ["Fatigue", selected.fatigue, "battery-medium"],
            ["Venue Access", selected.access, "key-round"],
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
            const tone: Tone = c.verified ? "success" : c.state === "Pending" || c.state === "Expiring" ? "warning" : "danger";
            return (
              <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                <span style={{ width: 30, height: 30, borderRadius: 8, background: "var(--bg-2)", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Icon name={c.icon} size={15} color={c.verified ? "var(--fs-teal)" : "var(--fg-4)"} /></span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--fg-1)" }}>{c.name}</div>
                  <div style={{ fontSize: 11, color: "var(--fg-4)" }}>{c.line1}{c.line2 && <> · {c.line2}</>}</div>
                </div>
                <Badge tone={tone} icon={c.verified ? "check" : "alert-triangle"}>{c.state}</Badge>
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
          {LOG.map((e, i) => {
            const [bg, fg] = STATUS[e[3]];
            return (
              <div key={i} style={{ display: "flex", gap: 10, padding: "11px 0", borderTop: i ? "1px solid var(--border)" : 0 }}>
                <span style={{ width: 28, height: 28, borderRadius: 7, background: bg, color: fg, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Icon name={e[2]} size={15} /></span>
                <div style={{ flex: 1 }}><div style={{ fontSize: 13, fontWeight: 600, color: "var(--fg-1)" }}>{e[0]}</div><div style={{ fontSize: 11.5, color: "var(--fg-4)" }}>{e[1]}</div></div>
                <span style={{ fontSize: 11, color: "var(--fg-4)", whiteSpace: "nowrap" }}>Today, 6:15am</span>
              </div>
            );
          })}
        </div>
      </Modal>
    </div>
  );
}
