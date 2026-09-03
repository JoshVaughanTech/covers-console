"use client";

import { useMemo, useState } from "react";
import {
  Card,
  Ring,
  Bar,
  MetricCard,
  Badge,
  Avatar,
  Button,
  Icon,
  STATUS,
  Modal,
  Field,
  useToast,
  useConfirm,
  Tabs,
} from "@/components/ui";
import type { Tone } from "@/lib/status";
import { SEED_EVENTS, type EventBooking } from "@/lib/events";
import { DAY_IDS, OFF, shiftsOf, week, type CrewRow } from "./roster";
import {
  useIdara,
  CREDENTIAL_TYPES,
  type Decision,
  type PublishResult,
  type RosterAssignment,
  type WorkFunction,
} from "@/lib/idara";
import { PageHead, CardHead, LinkBtn } from "@/components/screen/page-head";

/* ---- types ---- */
interface RosterRow {
  role: string;
  req: string;
  vals: number[];
}
interface Suggestion {
  id: number;
  title: string;
  sub: string;
  tone: Tone;
  metric: string; // which headline metric this nudges (for the toast)
}
interface FairnessRow {
  name: string;
  req: string;
  sch: string;
  label: string;
  tone: Tone;
}
interface OpenShift {
  id: number;
  role: string;
  day: string;
  time: string;
  tone: Tone;
}
interface Scenario {
  key: string;
  name: string;
  fairness: number;
  cost: string;
  coverage: number;
  overtime: string;
}
/* the week the roster grid displays, used to place catering engagements */
const WEEK_START = new Date("May 12, 2026");
const DAY_MS = 86400000;

export default function SchedulePage() {
  const toast = useToast();
  const confirm = useConfirm();
  const { workers, decideFor, evaluateRoster, recordPublish, site, sites } = useIdara();

  /* Which site this roster is being built for. A venue trades on a standing
     weekly roster; a catering operation exists only for its events, so the
     week is filled with engagements instead of role-hour requirements. */
  const [siteId, setSiteId] = useState("s-brightwater");
  const activeSite = site(siteId);
  const isCatering = activeSite?.kind === "catering";
  /* org behaviour is derived, never stored — an operator whose sites are all
     catering has no standing roster to show at all */
  const allCatering = sites.every((s) => s.kind === "catering");
  const siteName = activeSite?.name ?? "Site";

  const weekEvents = useMemo(
    () => SEED_EVENTS.filter((e) => e.siteId === siteId),
    [siteId],
  );
  const didOf = useMemo(() => Object.fromEntries(workers.map((w) => [w.name, w.did])), [workers]);
  const roleOf = useMemo(() => Object.fromEntries(workers.map((w) => [w.name, w.role])), [workers]);

  const days = ["Mon\n12", "Tue\n13", "Wed\n14", "Thu\n15", "Fri\n16", "Sat\n17", "Sun\n18"];

  const reqMap: Record<string, number> = {
    Bar: 64,
    "Wait Staff": 48,
    Kitchen: 40,
    Events: 36,
    Gaming: 24,
  };

  // status by fill ratio (unchanged logic — now reads from state)
  const cell = (v: number, req: number): [string, string] => {
    const ratio = v / req;
    if (ratio >= 0.98) return ["var(--success-bg)", "var(--success-fg)"]; // covered
    if (ratio >= 0.88) return ["var(--warning-bg)", "var(--warning-fg)"]; // at risk
    return ["var(--danger-bg)", "var(--danger-fg)"]; // uncovered
  };

  /* ---- state-backed data ---- */
  /* weekday cover holds; the gap opens Friday night onward — late
     and weekend shifts are the chronic hospitality staffing problem. */
  const [roster, setRoster] = useState<RosterRow[]>([
    { role: "Bar", req: "Req. 64h / day", vals: [64, 62, 64, 66, 70, 52, 44] },
    { role: "Wait Staff", req: "Req. 48h / day", vals: [48, 46, 44, 47, 48, 34, 28] },
    { role: "Kitchen", req: "Req. 40h / day", vals: [40, 38, 40, 42, 39, 30, 26] },
    { role: "Events", req: "Req. 36h / day", vals: [36, 34, 36, 33, 36, 24, 18] },
    { role: "Gaming", req: "Req. 24h / day", vals: [24, 22, 24, 24, 20, 14, 12] },
  ]);

  const fairness: FairnessRow[] = [
    { name: "Sophie Nguyen", req: "32h", sch: "31h", label: "Excellent", tone: "success" },
    { name: "Darie Roberts", req: "32h", sch: "29h", label: "Good", tone: "success" },
    { name: "Leanne Vidal", req: "24h", sch: "22h", label: "Fair", tone: "warning" },
    { name: "Jake Morrison", req: "24h", sch: "18h", label: "Needs Attention", tone: "danger" },
  ];

  const [suggestions, setSuggestions] = useState<Suggestion[]>([
    {
      id: 1,
      title: "Fill 7 open shifts to reach 100% coverage",
      sub: "High priority · Improves coverage by 4%",
      tone: "danger",
      metric: "coverage",
    },
    {
      id: 2,
      title: "Balance weekend load for fairer distribution",
      sub: "Reassign 6 shifts · Improves fairness by 5 pts",
      tone: "warning",
      metric: "fairness",
    },
    {
      id: 3,
      title: "Reduce overtime on Sat, May 17",
      sub: "Swap 3 shifts · Potential savings $2,140",
      tone: "info",
      metric: "cost",
    },
    {
      id: 4,
      title: "Consider staff shift preferences",
      sub: "7 matches available · Higher acceptance likely",
      tone: "teal",
      metric: "fairness",
    },
  ]);

  const [openShifts, setOpenShifts] = useState<OpenShift[]>([
    { id: 1, role: "Bar", day: "Sat, May 17", time: "4p – 12a", tone: "danger" },
    { id: 2, role: "Bar", day: "Sun, May 18", time: "11a – 7p", tone: "danger" },
    { id: 3, role: "Wait Staff", day: "Sat, May 17", time: "4p – 12a", tone: "warning" },
    { id: 4, role: "Gaming", day: "Sat, May 17", time: "4p – 12a", tone: "warning" },
    { id: 5, role: "Kitchen", day: "Sun, May 18", time: "7a – 3p", tone: "warning" },
    { id: 6, role: "Wait Staff", day: "Sun, May 18", time: "11a – 7p", tone: "info" },
    { id: 7, role: "Events", day: "Sat, May 17", time: "11a – 7p", tone: "info" },
  ]);

  // headline metrics held in state so suggestions / scenarios can nudge them
  const [fairnessScore, setFairnessScore] = useState(87);
  const [labourCost, setLabourCost] = useState(128450);
  const [coverage, setCoverage] = useState(96);

  const [published, setPublished] = useState<string | null>(null);

  /* ---- the rostered crew (Idara-backed) ---- */
  const [crew, setCrew] = useState<CrewRow[]>([
    { name: "Sophie Nguyen", shifts: week(["11a – 7p", "11a – 7p", "11a – 7p", "11a – 7p", "11a – 7p", OFF, OFF]), total: "40h" },
    // on the bar Mon–Thu, then the gaming floor on Saturday. A bartender by
    // title, so only that one shift demands an RSG — and he hasn't got one.
    {
      name: "Darie Roberts",
      shifts: week(
        ["4p – 12a", "4p – 12a", "4p – 12a", "4p – 12a", OFF, "4p – 12a", OFF],
        { 5: { duties: ["serve_alcohol", "gaming"], label: "gaming floor" } },
      ),
      total: "40h",
    },
    { name: "Aaron Patel", shifts: week(["4p – 12a", "4p – 12a", "4p – 12a", "4p – 12a", "4p – 12a", OFF, OFF]), total: "40h" },
    { name: "Priya Sharma", shifts: week(["11a – 7p", "11a – 7p", "11a – 7p", "11a – 7p", OFF, OFF, OFF]), total: "32h" },
    { name: "Leanne Vidal", shifts: week(["7a – 3p", "7a – 3p", "7a – 3p", "7a – 3p", "7a – 3p", OFF, OFF]), total: "40h" },
    // head chef: holds no RSA and doesn't need one — the licence binds to
    // alcohol service, so he clears the gate on induction + food handling
    { name: "Hassan Ali", shifts: week(["7a – 3p", "7a – 3p", "7a – 3p", "7a – 3p", "7a – 3p", OFF, OFF]), total: "40h" },
    { name: "Jake Morrison", shifts: week(["4p – 12a", "4p – 12a", OFF, "4p – 12a", "4p – 12a", OFF, OFF]), total: "32h" },
    { name: "Liam O'Brien", shifts: week(["7a – 3p", "7a – 3p", "7a – 3p", "7a – 3p", "7a – 3p", OFF, OFF]), total: "40h" },
    { name: "Michael Tan", shifts: week(["11a – 7p", "11a – 7p", "11a – 7p", "11a – 7p", OFF, OFF, OFF]), total: "32h" },
  ]);

  const shiftColor: Record<string, [string, string]> = {
    "7a – 3p": ["#E6F4F2", "#075A54"], // open / prep
    "11a – 7p": ["#E8F1FC", "#1E5FB0"], // day
    "4p – 12a": ["#EDEAFB", "#5B4BC4"], // evening / close
  };

  const assignmentsOf = (rows: CrewRow[]): RosterAssignment[] =>
    rows
      .map((c) => ({ did: didOf[c.name], shifts: shiftsOf(c) }))
      .filter((a) => Boolean(a.did));

  /* what each person is rostered onto, for explaining assignment-driven blocks */
  const dutyLabelOf = useMemo(
    () =>
      Object.fromEntries(
        crew.map((c) => [
          c.name,
          c.shifts
            .map((sh, i) => (sh.label ? `${DAY_IDS[i]} ${sh.label}` : null))
            .filter(Boolean)
            .join(", ") || undefined,
        ]),
      ) as Record<string, string | undefined>,
    [crew],
  );

  /* eligibility per crew member — live preview from Idara (no audit) */
  const decisionByName = useMemo(() => {
    const out: Record<string, Decision | null> = {};
    for (const c of crew) {
      out[c.name] = decideFor(didOf[c.name], "be_rostered", siteId, shiftsOf(c));
    }
    return out;
  }, [crew, decideFor, didOf, siteId]);

  const eligibleCount = useMemo(
    () => crew.filter((c) => decisionByName[c.name]?.allowed).length,
    [crew, decisionByName],
  );
  const blockedCount = crew.length - eligibleCount;

  const scenarios: Scenario[] = [
    { key: "balanced", name: "Balanced", fairness: 87, cost: "$128,450", coverage: 96, overtime: "42h" },
    { key: "cost", name: "Lowest cost", fairness: 81, cost: "$121,900", coverage: 93, overtime: "28h" },
    { key: "coverage", name: "Max coverage", fairness: 84, cost: "$134,200", coverage: 100, overtime: "61h" },
  ];

  /* ---- modal open flags ---- */
  const [compareOpen, setCompareOpen] = useState(false);
  const [openShiftsOpen, setOpenShiftsOpen] = useState(false);
  const [fairnessOpen, setFairnessOpen] = useState(false);
  const [gate, setGate] = useState<PublishResult | null>(null);

  // cell editor target: [rowIndex, dayIndex] or null
  const [editCell, setEditCell] = useState<{ row: number; day: number } | null>(null);
  const [editValue, setEditValue] = useState("");

  /* ---- derived display values ---- */
  const labourCostLabel = useMemo(
    () => "$" + labourCost.toLocaleString("en-US"),
    [labourCost]
  );
  const budgetPct = useMemo(() => Math.min(100, Math.round((labourCost / 135000) * 100)), [labourCost]);
  const fairnessLabel = fairnessScore >= 90 ? "Excellent" : fairnessScore >= 80 ? "Very Good" : "Fair";

  /* one line naming why a publish was refused — individuals, the roster, or both */
  const blockReasons = (r: PublishResult) => {
    const parts: string[] = [];
    if (r.blocked.length > 0) {
      parts.push(
        `${r.blocked.length} ineligible staff member${r.blocked.length === 1 ? "" : "s"}`,
      );
    }
    for (const c of r.uncovered) {
      parts.push(`no ${CREDENTIAL_TYPES[c.type].shortLabel} on shift`);
    }
    return parts.join(" · ");
  };

  const nowLabel = () => {
    const now = new Date();
    return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  };

  /* ---- actions ---- */
  const handlePublish = async () => {
    const result = evaluateRoster(siteId, assignmentsOf(crew));

    // Idara gate: a non-compliant roster cannot be published.
    if (!result.published) {
      recordPublish(siteId, result); // the blocked attempt is itself audited
      setGate(result);
      toast(`Publish blocked — ${blockReasons(result)}`, {
        tone: "danger",
        icon: "shield-alert",
      });
      return;
    }

    const ok = await confirm({
      title: "Publish roster?",
      body: `All ${result.eligible.length} rostered staff are credential-verified for ${siteName}. This notifies staff and locks the schedule for the week of May 12 – May 18.`,
      confirmLabel: "Publish",
      tone: "teal",
    });
    if (!ok) return;
    recordPublish(siteId, result);
    setPublished(nowLabel());
    toast(
      result.warnings.length
        ? `Roster published — ${result.warnings.length} expiring-credential warning${result.warnings.length === 1 ? "" : "s"} flagged`
        : "Roster published — all staff verified by Idara",
      { tone: "success", icon: "check" },
    );
  };

  // resolve the gate by publishing only the eligible staff. This can only
  // ever fix individual ineligibility — a roster-level gap survives dropping
  // people, so the result is re-checked rather than assumed published.
  const publishEligibleOnly = () => {
    if (!gate) return;
    const eligibleNames = new Set(gate.eligible.map((d) => d.context.subjectName));
    const removed = gate.blocked.length;
    const remaining = crew.filter((c) => eligibleNames.has(c.name));
    const result = evaluateRoster(siteId, assignmentsOf(remaining));

    if (!result.published) {
      setGate(result);
      toast(`Still blocked — ${blockReasons(result)}`, {
        tone: "danger",
        icon: "shield-alert",
      });
      return;
    }

    setCrew(remaining);
    recordPublish(siteId, result);
    setPublished(nowLabel());
    setGate(null);
    toast(
      `Published ${result.eligible.length} verified staff member${result.eligible.length === 1 ? "" : "s"} — ${removed} removed`,
      { tone: "success", icon: "check" },
    );
  };

  const applySuggestion = (s: Suggestion) => {
    setSuggestions((list) => list.filter((x) => x.id !== s.id));
    if (s.metric === "coverage") setCoverage((c) => Math.min(100, c + 2));
    else if (s.metric === "fairness") setFairnessScore((f) => Math.min(100, f + 3));
    else if (s.metric === "cost") setLabourCost((c) => Math.max(0, c - 2140));
    toast(`Applied: ${s.title}`, { tone: "success", icon: "sparkles" });
  };

  const fillShift = (shift: OpenShift) => {
    setOpenShifts((list) => list.filter((x) => x.id !== shift.id));
    setCoverage((c) => Math.min(100, c + 1));
    toast(`Filled ${shift.role} · ${shift.day}`, { tone: "success", icon: "user-check" });
  };

  const applyScenario = (s: Scenario) => {
    setFairnessScore(s.fairness);
    setLabourCost(Number(s.cost.replace(/[$,]/g, "")));
    setCoverage(s.coverage);
    setCompareOpen(false);
    toast(`Applied "${s.name}" scenario`, { tone: "success", icon: "git-compare" });
  };

  const openCellEditor = (row: number, day: number) => {
    setEditValue(String(roster[row].vals[day]));
    setEditCell({ row, day });
  };

  const stepCell = (delta: number) => {
    setEditValue((v) => String(Math.max(0, (parseInt(v, 10) || 0) + delta)));
  };

  const saveCell = () => {
    if (!editCell) return;
    const next = Math.max(0, parseInt(editValue, 10) || 0);
    setRoster((rows) =>
      rows.map((r, i) =>
        i === editCell.row
          ? { ...r, vals: r.vals.map((v, j) => (j === editCell.day ? next : v)) }
          : r
      )
    );
    toast(`Updated ${roster[editCell.row].role} to ${next}h`, { tone: "teal", icon: "pencil" });
    setEditCell(null);
  };

  const editingRole = editCell ? roster[editCell.row].role : "";
  const editingDay = editCell ? days[editCell.day].replace("\n", " ") : "";
  const editingReq = editCell ? reqMap[roster[editCell.row].role] : 0;

  /* eligibility badge for a decision */
  const eligBadge = (d: Decision | null): { tone: Tone; label: string; icon: string } => {
    if (!d || !d.allowed) return { tone: "danger", label: "Blocked", icon: "shield-alert" };
    if (d.warnings > 0) return { tone: "warning", label: "Warning", icon: "alert-triangle" };
    return { tone: "success", label: "Eligible", icon: "shield-check" };
  };

  return (
    <div>
      <PageHead
        title={
          <span style={{ display: "inline-flex", alignItems: "center", gap: 12 }}>
            Schedule
            {published && (
              <Badge tone="success" icon="check-circle">
                Published {published}
              </Badge>
            )}
          </span>
        }
        sub={
          allCatering
            ? "Engagement staffing across your catering operations — credential-checked by Idara before every publish."
            : "AI rostering balanced for fairness, coverage and cost — and credential-checked by Idara before every publish."
        }
        right={
          <div style={{ display: "flex", gap: 10 }}>
            <Button variant="sec" size="sm" icon="git-compare" onClick={() => setCompareOpen(true)}>
              Compare Scenarios
            </Button>
            <Button size="sm" icon="send" onClick={handlePublish}>
              Publish Roster
            </Button>
          </div>
        }
      />

      <div style={{ marginBottom: 16 }}>
        <Tabs
          tabs={sites.map((x) => x.name)}
          value={siteName}
          onChange={(v) => setSiteId(sites.find((x) => x.name === v)?.id ?? siteId)}
        />
      </div>

      {isCatering ? (
        <CateringWeek siteName={siteName} events={weekEvents} />
      ) : (
      <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16, marginBottom: 16 }}>
        <Card pad={18}>
          <div style={{ fontSize: 13, color: "var(--fg-3)", fontWeight: 600, marginBottom: 8 }}>Roster Fairness Score</div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Ring value={fairnessScore} label={`${fairnessScore}%`} size={76} />
            <div><div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--success-fg)" }}>{fairnessLabel}</div><div style={{ fontSize: 11.5, color: "var(--success-fg)", marginTop: 3 }}>↑ 6 pts vs last 7 days</div></div>
          </div>
        </Card>
        <MetricCard label="Labour Cost" value={labourCostLabel} trend="↓ 4.3% vs last 7 days" trendTone="var(--success-fg)">
          <div style={{ marginTop: 10 }}><Bar value={budgetPct} /></div>
          <div style={{ fontSize: 11, color: "var(--fg-4)", marginTop: 5 }}>Budget $135,000</div>
        </MetricCard>
        <Card pad={18}>
          <div style={{ fontSize: 13, color: "var(--fg-3)", fontWeight: 600, marginBottom: 8 }}>Coverage</div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Ring value={coverage} label={`${coverage}%`} size={76} color="var(--success)" />
            <div><div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--fg-1)" }}>{coverage >= 100 ? "Fully Covered" : "On Track"}</div><div style={{ fontSize: 11.5, color: "var(--success-fg)", marginTop: 3 }}>↑ 3% vs last 7 days</div></div>
          </div>
        </Card>
        <MetricCard label="Open Shifts" value={String(openShifts.length)} status={openShifts.length ? "Needs Fill" : "All Filled"} statusTone={openShifts.length ? "var(--warning-fg)" : "var(--success-fg)"}>
          <div style={{ marginTop: 8 }}><LinkBtn onClick={() => setOpenShiftsOpen(true)}>View open shifts</LinkBtn></div>
        </MetricCard>
      </div>
      {/* roster grid */}
      <Card style={{ marginBottom: 16 }}>
        <CardHead
          title="Weekly Roster Overview"
          right={
            <div style={{ display: "flex", gap: 14, fontSize: 11.5, color: "var(--fg-3)" }}>
              <span><span style={{ color: "var(--success)" }}>■</span> Covered</span>
              <span><span style={{ color: "var(--warning)" }}>■</span> At Risk</span>
              <span><span style={{ color: "var(--danger)" }}>■</span> Uncovered</span>
            </div>
          }
        />
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: "6px 10px", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--fg-4)" }}>Role</th>
              {days.map((d) => <th key={d} style={{ padding: "6px 4px", fontSize: 11.5, color: "var(--fg-3)", whiteSpace: "pre-line", fontWeight: 600 }}>{d}</th>)}
            </tr>
          </thead>
          <tbody>
            {roster.map((r, i) => (
              <tr key={i}>
                <td style={{ padding: "6px 10px" }}><div style={{ fontSize: 13, fontWeight: 600, color: "var(--fg-1)" }}>{r.role}</div><div style={{ fontSize: 11, color: "var(--fg-4)" }}>{r.req}</div></td>
                {r.vals.map((v, j) => {
                  const [bg, fg] = cell(v, reqMap[r.role]);
                  return (
                    <td key={j} style={{ padding: "4px 4px" }}>
                      <button
                        type="button"
                        onClick={() => openCellEditor(i, j)}
                        aria-label={`Edit ${r.role} ${days[j].replace("\n", " ")} hours`}
                        className="fs-tnum"
                        style={{ width: "100%", background: bg, color: fg, fontSize: 13, fontWeight: 700, textAlign: "center", padding: "11px 0", borderRadius: 8, border: "1px solid transparent", cursor: "pointer", fontFamily: "inherit", transition: ".15s" }}
                      >
                        {v}h
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 16 }}>
        {/* AI roster preview — Idara-verified */}
        <Card pad={0}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
            <h4 style={{ margin: 0, fontSize: 15.5, flex: 1 }}>AI Roster Preview <span style={{ fontSize: 12.5, fontWeight: 500, color: "var(--fg-4)" }}>({siteName} · May 12 – 18)</span></h4>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--fg-3)", background: "var(--idara-tint)", padding: "4px 9px", borderRadius: 999 }}>
              <img src="/assets/idara-icon-t.png" alt="" style={{ width: 13, height: 13, objectFit: "contain" }} />
              {eligibleCount}/{crew.length} verified
            </span>
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: "8px 16px", fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", color: "var(--fg-4)" }}>Staff</th>
                {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => <th key={i} style={{ padding: "8px 4px", fontSize: 11, color: "var(--fg-4)", fontWeight: 600 }}>{d}</th>)}
                <th style={{ padding: "8px 8px", fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", color: "var(--fg-4)", textAlign: "right" }}>Total</th>
                <th style={{ padding: "8px 12px", fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", color: "var(--fg-4)", textAlign: "right" }}>Eligibility</th>
              </tr>
            </thead>
            <tbody>
              {crew.map((p, i) => {
                const d = decisionByName[p.name];
                const b = eligBadge(d);
                const blockReason = d && !d.allowed ? d.reasons.find((r) => r.outcome === "fail")?.detail : null;
                return (
                  <tr key={i} style={{ borderTop: "1px solid var(--border)", opacity: d && !d.allowed ? 0.92 : 1 }}>
                    <td style={{ padding: "8px 16px" }}><div style={{ display: "flex", alignItems: "center", gap: 8 }}><Avatar name={p.name} size={24} /><span><div style={{ fontWeight: 600, color: "var(--fg-1)", fontSize: 12.5 }}>{p.name}</div><div style={{ fontSize: 10.5, color: "var(--fg-4)" }}>{roleOf[p.name]}{dutyLabelOf[p.name] && <span style={{ color: "var(--warning-fg)", fontWeight: 600 }}> · {dutyLabelOf[p.name]}</span>}</div></span></div></td>
                    {p.shifts.map((sh, j) => {
                      const c = shiftColor[sh.time];
                      if (sh.time === OFF || !c) {
                        return <td key={j} style={{ padding: "5px 3px", textAlign: "center" }}><span style={{ color: "var(--fg-4)" }}>—</span></td>;
                      }
                      // a shift assigned away from the person's usual duties is
                      // ringed, so a block on one day is visible in the grid
                      return (
                        <td key={j} style={{ padding: "5px 3px", textAlign: "center" }}>
                          <span
                            className="fs-tnum"
                            title={sh.label ? `${DAY_IDS[j]} · ${sh.label}` : undefined}
                            style={{ background: c[0], color: c[1], fontSize: 10.5, fontWeight: 600, padding: "4px 5px", borderRadius: 6, display: "inline-block", whiteSpace: "nowrap", boxShadow: sh.label ? "0 0 0 1.5px var(--warning)" : undefined }}
                          >
                            {sh.time}
                          </span>
                        </td>
                      );
                    })}
                    <td className="fs-tnum" style={{ padding: "8px 8px", textAlign: "right", fontWeight: 700, color: "var(--fg-1)" }}>{p.total}</td>
                    <td style={{ padding: "8px 12px", textAlign: "right" }}>
                      <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
                        <Badge tone={b.tone} icon={b.icon}>{b.label}</Badge>
                        {blockReason && <span style={{ fontSize: 10, color: "var(--danger-fg)", maxWidth: 150, textAlign: "right" }}>{blockReason}</span>}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {blockedCount > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "11px 16px", borderTop: "1px solid var(--border)", background: "var(--danger-bg)", fontSize: 12.5, color: "var(--danger-fg)" }}>
              <Icon name="shield-alert" size={15} />
              {blockedCount} staff member{blockedCount === 1 ? "" : "s"} can&apos;t be rostered until credentials are resolved — Idara will block publish.
            </div>
          )}
        </Card>
        {/* AI suggestions + fairness */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Card>
            <CardHead
              title={<span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}><Icon name="sparkles" size={16} color="var(--fs-teal)" />AI Suggestions</span>}
              right={<span style={{ fontSize: 11.5, color: "var(--fg-4)" }}>{suggestions.length} recommendation{suggestions.length === 1 ? "" : "s"}</span>}
            />
            <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
              {suggestions.length === 0 ? (
                <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "14px 12px", border: "1px dashed var(--border-2)", borderRadius: 10, color: "var(--fg-3)", fontSize: 12.5 }}>
                  <Icon name="check-circle" size={16} color="var(--success-fg)" />
                  All suggestions applied — roster optimised.
                </div>
              ) : (
                suggestions.map((s) => {
                  const [, , dc] = STATUS[s.tone];
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => applySuggestion(s)}
                      aria-label={`Apply suggestion: ${s.title}`}
                      style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 10, cursor: "pointer", background: "#fff", font: "inherit", textAlign: "left", width: "100%" }}
                      className="hov-row"
                    >
                      <span style={{ width: 8, height: 8, borderRadius: 999, background: dc, flexShrink: 0 }} />
                      <div style={{ flex: 1 }}><div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--fg-1)" }}>{s.title}</div><div style={{ fontSize: 11, color: "var(--fg-4)" }}>{s.sub}</div></div>
                      <Icon name="chevron-right" size={16} color="var(--fg-4)" />
                    </button>
                  );
                })
              )}
            </div>
          </Card>
          <Card>
            <CardHead title="Fairness Overview" right={<LinkBtn onClick={() => setFairnessOpen(true)}>View all</LinkBtn>} />
            <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
              {fairness.map((f, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 9 }}>
                  <Avatar name={f.name} size={26} />
                  <span style={{ flex: 1, fontSize: 12.5, fontWeight: 600, color: "var(--fg-1)" }}>{f.name}</span>
                  <span className="fs-tnum" style={{ fontSize: 11.5, color: "var(--fg-4)" }}>{f.sch}/{f.req}</span>
                  <Badge tone={f.tone}>{f.label}</Badge>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      </>
      )}

      {/* ---- Publish gate modal (Idara) ---- */}
      <Modal
        open={gate !== null}
        onClose={() => setGate(null)}
        title="Publish blocked by Idara"
        size="md"
        footer={
          <>
            <Button variant="sec" size="sm" onClick={() => setGate(null)}>
              Back to roster
            </Button>
            {/* dropping people cannot satisfy a roster-level requirement */}
            {(gate?.uncovered.length ?? 0) === 0 && (
              <Button variant="pri" size="sm" icon="shield-check" onClick={publishEligibleOnly}>
                Publish {gate?.eligible.length ?? 0} verified
              </Button>
            )}
          </>
        }
      >
        {gate && (
          <div>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "12px 14px", borderRadius: 10, background: "var(--danger-bg)", marginBottom: 14 }}>
              <Icon name="shield-alert" size={18} color="var(--danger-fg)" />
              <div style={{ fontSize: 13, color: "var(--danger-fg)" }}>
                {gate.blocked.length > 0 && (
                  <>
                    {gate.blocked.length} of {gate.decisions.length} rostered staff are not eligible for {siteName}.{" "}
                  </>
                )}
                {gate.uncovered.length > 0 && (
                  <>
                    This roster has no{" "}
                    {gate.uncovered.map((c) => CREDENTIAL_TYPES[c.type].shortLabel).join(" or ")}{" "}
                    on shift. That is required of the venue rather than of any one person, so removing staff won&apos;t resolve it.{" "}
                  </>
                )}
                This attempt has been written to the audit log.
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {gate.uncovered.map((c) => (
                <div key={c.type} style={{ border: "1px solid var(--warning)", background: "var(--warning-bg)", borderRadius: 12, padding: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 6 }}>
                    <span style={{ width: 28, height: 28, borderRadius: 8, background: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <Icon name={CREDENTIAL_TYPES[c.type].icon} size={15} color="var(--warning-fg)" />
                    </span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--fg-1)" }}>
                        {CREDENTIAL_TYPES[c.type].label}
                      </div>
                      <div style={{ fontSize: 11.5, color: "var(--fg-4)" }}>Required of the roster, not the person</div>
                    </div>
                    <Badge tone="warning" icon="users">Not covered</Badge>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--fg-2)" }}>
                    <span style={{ width: 6, height: 6, borderRadius: 999, background: "var(--warning)", flexShrink: 0 }} />
                    {c.detail}
                  </div>
                </div>
              ))}
              {gate.blocked.map((d) => (
                <div key={d.context.subject} style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 8 }}>
                    <Avatar name={d.context.subjectName} size={28} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--fg-1)" }}>{d.context.subjectName}</div>
                      <div style={{ fontSize: 11.5, color: "var(--fg-4)" }}>{roleOf[d.context.subjectName]}{dutyLabelOf[d.context.subjectName] && <span style={{ color: "var(--warning-fg)", fontWeight: 600 }}> · {dutyLabelOf[d.context.subjectName]}</span>}</div>
                    </div>
                    <Badge tone="danger" icon="shield-alert">Blocked</Badge>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                    {d.reasons.filter((r) => r.outcome === "fail").map((r, i) => (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--fg-2)" }}>
                        <span style={{ width: 6, height: 6, borderRadius: 999, background: "var(--danger)", flexShrink: 0 }} />
                        {r.detail}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Modal>

      {/* ---- Compare Scenarios modal ---- */}
      <Modal open={compareOpen} onClose={() => setCompareOpen(false)} title="Compare Scenarios" size="lg">
        <p style={{ margin: "0 0 16px", fontSize: 13.5, color: "var(--fg-3)" }}>
          Three AI-generated rosters for May 12 – May 18. Apply one to update the headline metrics.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${scenarios.length}, 1fr)`, gap: 14 }}>
          {scenarios.map((s) => (
            <div key={s.key} style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ fontSize: 14.5, fontWeight: 700, color: "var(--fg-1)" }}>{s.name}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {[
                  ["Fairness", `${s.fairness}%`],
                  ["Labour cost", s.cost],
                  ["Coverage", `${s.coverage}%`],
                  ["Overtime", s.overtime],
                ].map(([k, v]) => (
                  <div key={k} style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ fontSize: 12, color: "var(--fg-4)" }}>{k}</span>
                    <span className="fs-tnum" style={{ fontSize: 14, fontWeight: 700, color: "var(--fg-1)" }}>{v}</span>
                  </div>
                ))}
              </div>
              <Button variant="pri" size="sm" icon="check" onClick={() => applyScenario(s)} style={{ width: "100%" }}>
                Apply
              </Button>
            </div>
          ))}
        </div>
      </Modal>

      {/* ---- Open shifts modal ---- */}
      <Modal
        open={openShiftsOpen}
        onClose={() => setOpenShiftsOpen(false)}
        title={`Open Shifts (${openShifts.length})`}
        size="md"
      >
        {openShifts.length === 0 ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "28px 0", textAlign: "center" }}>
            <Icon name="check-circle" size={28} color="var(--success-fg)" />
            <div style={{ fontSize: 14.5, fontWeight: 700, color: "var(--fg-1)" }}>All shifts filled</div>
            <div style={{ fontSize: 13, color: "var(--fg-3)" }}>Coverage is at full strength for this week.</div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
            {openShifts.map((sh) => {
              const [, , dc] = STATUS[sh.tone];
              return (
                <div key={sh.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 10 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 999, background: dc, flexShrink: 0 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--fg-1)" }}>{sh.role}</div>
                    <div style={{ fontSize: 11.5, color: "var(--fg-4)" }}>{sh.day} · {sh.time}</div>
                  </div>
                  <Button variant="sec" size="sm" icon="user-plus" onClick={() => fillShift(sh)}>
                    Fill
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </Modal>

      {/* ---- Fairness "View all" modal ---- */}
      <Modal open={fairnessOpen} onClose={() => setFairnessOpen(false)} title="Fairness Overview" size="md">
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {fairness.map((f, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 10 }}>
              <Avatar name={f.name} size={30} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--fg-1)" }}>{f.name}</div>
                <div style={{ fontSize: 11.5, color: "var(--fg-4)" }}>Scheduled {f.sch} of requested {f.req}</div>
              </div>
              <Badge tone={f.tone}>{f.label}</Badge>
            </div>
          ))}
        </div>
      </Modal>

      {/* ---- Roster cell editor modal ---- */}
      <Modal
        open={editCell !== null}
        onClose={() => setEditCell(null)}
        title="Edit Rostered Hours"
        size="sm"
        footer={
          <>
            <Button variant="sec" size="sm" onClick={() => setEditCell(null)}>
              Cancel
            </Button>
            <Button variant="pri" size="sm" icon="check" onClick={saveCell}>
              Save
            </Button>
          </>
        }
      >
        <div style={{ marginBottom: 14, fontSize: 13, color: "var(--fg-3)" }}>
          {editingRole} · {editingDay} · target {editingReq}h
        </div>
        <Field label="Rostered hours">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Button variant="sec" size="sm" icon="minus" onClick={() => stepCell(-1)} aria-label="Decrease" />
            <input
              type="number"
              min={0}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              aria-label="Rostered hours"
              className="fs-tnum"
              style={{
                flex: 1,
                textAlign: "center",
                background: "#fff",
                border: "1px solid var(--border-2)",
                borderRadius: 10,
                padding: "10px 12px",
                font: "inherit",
                fontSize: 18,
                fontWeight: 700,
                color: "var(--fg-1)",
                outline: "none",
              }}
            />
            <Button variant="sec" size="sm" icon="plus" onClick={() => stepCell(1)} aria-label="Increase" />
          </div>
        </Field>
      </Modal>
    </div>
  );
}

/* ============================================================
   A catering operation has no standing week to grid — it exists for
   its engagements. So the frame stays Mon–Sun, and what fills it
   changes: one row per event, spanning the days it runs, showing
   whether the crew is filled rather than whether a daily hour
   requirement is met.
   ============================================================ */
const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Where an engagement sits in the displayed week, or null if it misses it. */
function weekSpan(ev: EventBooking): { from: number; to: number } | null {
  const start = new Date(ev.start).getTime();
  const end = new Date(ev.end).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  const w0 = WEEK_START.getTime();
  const w1 = w0 + 7 * DAY_MS - 1;
  if (end < w0 || start > w1) return null;
  return {
    from: Math.max(0, Math.floor((start - w0) / DAY_MS)),
    to: Math.min(6, Math.floor((end - w0) / DAY_MS)),
  };
}

function CateringWeek({ siteName, events }: { siteName: string; events: EventBooking[] }) {
  const rows = events
    .map((e) => ({ ev: e, span: weekSpan(e) }))
    .filter((r): r is { ev: EventBooking; span: { from: number; to: number } } => r.span !== null)
    .sort((a, b) => a.span.from - b.span.from);

  const staffed = rows.reduce((a, r) => a + r.ev.filled, 0);
  const needed = rows.reduce((a, r) => a + r.ev.required, 0);

  return (
    <Card style={{ marginBottom: 16 }} pad={0}>
      <CardHead
        title={`${siteName} — this week`}
        right={
          <span className="fs-tnum" style={{ fontSize: 12, fontWeight: 700, color: needed && staffed < needed ? "var(--warning-fg)" : "var(--fg-3)" }}>
            {rows.length} engagement{rows.length === 1 ? "" : "s"} · {staffed}/{needed} crew
          </span>
        }
      />

      {rows.length === 0 ? (
        <div style={{ padding: 32, textAlign: "center", fontSize: 13.5, color: "var(--fg-4)" }}>
          No engagements at {siteName} this week. A catering operation has no standing roster —
          its week is whatever it is booked for.
        </div>
      ) : (
        <div style={{ padding: "8px 20px 18px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "220px repeat(7,1fr)", gap: 6, alignItems: "center", paddingBottom: 8 }}>
            <span />
            {DAY_LABELS.map((d, i) => (
              <span key={d} className="fs-tnum" style={{ fontSize: 11, color: "var(--fg-4)", textAlign: "center", fontWeight: 600 }}>
                {d} {12 + i}
              </span>
            ))}
          </div>

          {rows.map(({ ev, span }) => {
            const short = ev.filled < ev.required;
            return (
              <div key={ev.id} style={{ display: "grid", gridTemplateColumns: "220px repeat(7,1fr)", gap: 6, alignItems: "center", padding: "6px 0", borderTop: "1px solid var(--border)" }}>
                <span style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--fg-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ev.name}</div>
                  <div style={{ fontSize: 10.5, color: "var(--fg-4)" }}>{ev.client}</div>
                </span>
                <span
                  style={{
                    gridColumn: `${span.from + 2} / ${span.to + 3}`,
                    background: short ? "var(--warning-bg)" : "var(--fs-teal-tint)",
                    color: short ? "var(--warning-fg)" : "var(--fs-teal)",
                    border: `1px solid ${short ? "var(--warning)" : "var(--fs-teal)"}`,
                    borderRadius: 7,
                    padding: "6px 10px",
                    fontSize: 11.5,
                    fontWeight: 600,
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 8,
                    whiteSpace: "nowrap",
                  }}
                >
                  <span>{ev.status}</span>
                  <span className="fs-tnum">{ev.filled}/{ev.required} crew</span>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
