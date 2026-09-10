"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { Card, Badge, Icon, Button } from "@/components/ui";
import { CardHead, LinkBtn, PageHead } from "@/components/screen/page-head";
import { useIdara, shortHash } from "@/lib/idara";
import { deliveredReports } from "@/lib/reports/delivered";

/* ============================================================
   Reports — an index of the reports this system can produce.

   It could produce one, and showed five. The screen carried
   sixteen KPI figures across four ranges, a fairness trend with
   three series, labour cost against a budget, an attendance
   breakdown, an overtime split and a table of five saved reports
   with working View and Download buttons. Every one of those was
   a literal in this file. Switching the range changed the numbers
   because a second set of literals was indexed; it did not read
   anything.

   The whole screen already carried a banner saying so. That is
   the state #42 left it in — labelled, and still five charts
   deep. Labelling stops a figure lying. It does not stop a
   manager spending a minute reading it before remembering they
   cannot use it, and it does not stop the Generate Report button
   from producing a row in a table that means nothing.

   So: what exists, and what would have to exist first. The second
   list is the part worth keeping from the old page — the design's
   intent was right, and naming the blocker turns a silent gap
   into a line somebody has to delete on purpose. Same reason the
   audit-events test keeps a PENDING map instead of a comment.
   ============================================================ */

interface Missing {
  name: string;
  /** what would have to exist first — a fact about this repo, not a wish. */
  blocker: string;
  /** where a reader can go and check the blocker for themselves. */
  where: string;
}

/**
 * The four analytics the old screen drew, and why none of them can be drawn.
 *
 * Every blocker here is checkable in the file named beside it. That is the
 * bar: "not built yet" with no reason is the same silence as an invented
 * number, one indirection further along.
 */
const MISSING: Missing[] = [
  {
    name: "Fairness over a period",
    blocker:
      "Fairness is computed per candidate at the moment a shift is matched, from " +
      "the hours they are already rostered. Nothing stores the distribution across " +
      "a week, so there is no series to plot and no venue-level score to average.",
    where: "lib/matching/matcher.ts",
  },
  {
    name: "Labour cost",
    blocker:
      "Shifts can already be priced against the award properly — but pricing needs " +
      "each person's classification Level, and that module refuses to infer one " +
      "from a job title, because a wrong default would be indistinguishable from a " +
      "confirmed one. No Level is recorded against anybody yet. Separately, no " +
      "budget figure exists anywhere in the system to compare a cost against.",
    where: "lib/awards/rates.ts",
  },
  {
    name: "Attendance rate",
    blocker:
      "A punch carries no rostered start, so lateness is not computable. Absence " +
      "needs a roster of who was expected — somebody who never arrived appears in " +
      "a list of punches not at all. Both need rostered shifts stored against " +
      "people, which is the same gap the attendance tile names.",
    where: "app/(console)/attendance/page.tsx",
  },
  {
    name: "Overtime",
    blocker:
      "The award engine lists overtime first among the things it deliberately does " +
      "not model, alongside allowances, junior rates and enterprise agreements. An " +
      "overtime figure would have to come from somewhere that has not been written.",
    where: "NOT_MODELLED in lib/awards/rates.ts",
  },
];

/** Real screens that already own their standing data. */
const ELSEWHERE: [string, string, string, string][] = [
  ["Break compliance, live", "Who is approaching a meal break right now, off the clock.", "coffee", "/breaks"],
  ["Credential standing", "Who holds what, what has lapsed, what lapses next month.", "shield-alert", "/credentials"],
  ["The audit chain", "Every consequential event, hash-linked, in order.", "file-text", "/audit"],
];

export default function ReportsPage() {
  const router = useRouter();
  const { auditLog } = useIdara();

  const delivered = useMemo(() => deliveredReports(auditLog), [auditLog]);

  return (
    <div>
      <PageHead
        title="Reports"
        sub="What this system can report from its own records — and what it cannot yet."
      />

      {/* The one real report. */}
      <Card pad={0} style={{ marginBottom: 16, overflow: "hidden" }}>
        <div style={{ display: "flex", gap: 18, padding: 20, alignItems: "flex-start" }}>
          <span
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              background: "var(--fs-teal-tint)",
              color: "var(--fs-teal-700)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <Icon name="file-check-2" size={22} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
              <h4 style={{ margin: 0, fontSize: 16 }}>Break loading</h4>
              <Badge tone="success" dot>
                Computed
              </Badge>
            </div>
            <p style={{ margin: "0 0 12px", fontSize: 13, lineHeight: 1.6, color: "var(--fg-2)", maxWidth: 620 }}>
              What a completed week actually cost in missed-meal loading — per person, per
              shift, with the HIGA clause attached to each row. Folded from the same time
              clock the floor view reads, and exported as the CSV payroll takes. Nothing
              ticks: every shift in a closed week is closed, so the figures are stable.
            </p>
            <Button variant="pri" size="sm" icon="arrow-right" onClick={() => router.push("/reports/breaks")}>
              Open break loading
            </Button>
          </div>
        </div>
      </Card>

      {/* What this venue has actually produced. */}
      <Card style={{ marginBottom: 16 }}>
        <CardHead
          title="Delivered reports"
          right={
            <span style={{ fontSize: 12, color: "var(--fg-4)" }}>
              {delivered.length === 0
                ? "from the audit chain"
                : `${delivered.length} on the chain`}
            </span>
          }
        />
        {delivered.length === 0 ? (
          <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.6, color: "var(--fg-3)" }}>
            None yet. Delivery is scheduled outside the app — whatever already runs on a timer
            posts to <code>/api/reports/weekly/run</code>, which builds last week&rsquo;s break
            loading, writes it, and appends a <code>report.delivered</code> event. This table
            folds those events, so it fills in on its own the first time the schedule fires.
            An empty table here means no report has been delivered, which is worth knowing;
            the five rows that used to sit here meant nothing at all.
          </p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="fs-tnum" style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr>
                  {["Week", "Breaches", "Loading hrs", "File", "Content", ""].map((h, i) => (
                    <th
                      key={h || "trigger"}
                      style={{
                        textAlign: i === 1 || i === 2 ? "right" : "left",
                        fontSize: 11,
                        fontWeight: 700,
                        letterSpacing: ".04em",
                        textTransform: "uppercase",
                        color: "var(--fg-4)",
                        padding: "8px 12px",
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {delivered.map((r) => (
                  <tr key={r.seq} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={{ padding: "10px 12px", fontWeight: 600, color: "var(--fg-1)" }}>{r.weekLabel}</td>
                    <td style={{ padding: "10px 12px", textAlign: "right", color: r.breaches > 0 ? "var(--danger-fg)" : "var(--fg-2)" }}>{r.breaches}</td>
                    <td style={{ padding: "10px 12px", textAlign: "right", color: "var(--fg-2)" }}>{r.loadingHours.toFixed(2)}</td>
                    <td style={{ padding: "10px 12px", color: "var(--fg-3)", maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={`${r.target} · ${r.bytes} bytes`}>{r.filename}</td>
                    {/* the hash is the point: a row here is checkable against the file it names */}
                    <td style={{ padding: "10px 12px", color: "var(--fg-4)", fontSize: 11.5 }}>{r.contentHash ? shortHash(r.contentHash) : "—"}</td>
                    <td style={{ padding: "10px 12px", textAlign: "right" }}>
                      <Badge tone={r.trigger === "schedule" ? "neutral" : "info"}>{r.trigger}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ marginTop: 12 }}>
              <LinkBtn href="/audit">Find these on the chain</LinkBtn>
            </div>
          </div>
        )}
      </Card>

      {/* Real data that already has a home. */}
      <Card style={{ marginBottom: 16 }}>
        <CardHead title="Reported on their own screens" />
        <p style={{ margin: "-4px 0 14px", fontSize: 12.5, lineHeight: 1.6, color: "var(--fg-3)" }}>
          These are folded from the chain and the clock, and they are live rather than
          periodic. Restating them here would be a second copy that can disagree with the
          first.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
          {ELSEWHERE.map(([name, what, icon, href]) => (
            <div
              key={href}
              style={{
                border: "1px solid var(--border)",
                borderRadius: 10,
                padding: 14,
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <Icon name={icon} size={16} color="var(--fg-3)" />
                <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--fg-1)" }}>{name}</span>
              </span>
              <span style={{ fontSize: 12, lineHeight: 1.55, color: "var(--fg-3)", flex: 1 }}>{what}</span>
              <LinkBtn href={href}>Open</LinkBtn>
            </div>
          ))}
        </div>
      </Card>

      {/* What the old screen drew, and why it could not. */}
      <Card>
        <CardHead
          title="Not built yet"
          right={
            <span style={{ fontSize: 12, color: "var(--fg-4)" }}>
              {MISSING.length} report{MISSING.length === 1 ? "" : "s"} this screen used to draw
            </span>
          }
        />
        <p style={{ margin: "-4px 0 16px", fontSize: 12.5, lineHeight: 1.6, color: "var(--fg-3)" }}>
          Each of these was a chart here until now, filled with numbers no code derived.
          The intent behind them is right and worth keeping; the figures were not. Every
          blocker below can be checked in the file beside it.
        </p>
        <div style={{ display: "flex", flexDirection: "column" }}>
          {MISSING.map((m, i) => (
            <div
              key={m.name}
              style={{
                display: "flex",
                gap: 14,
                padding: "14px 0",
                borderTop: i === 0 ? "none" : "1px solid var(--border)",
                alignItems: "flex-start",
              }}
            >
              <span
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 8,
                  background: "var(--bg-2, #f1f3f5)",
                  color: "var(--fg-4)",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  marginTop: 1,
                }}
              >
                <Icon name="circle-dashed" size={15} />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--fg-1)", marginBottom: 3 }}>
                  {m.name}
                </div>
                <div style={{ fontSize: 12.5, lineHeight: 1.6, color: "var(--fg-3)", maxWidth: 760 }}>
                  {m.blocker}
                </div>
                <code
                  style={{
                    display: "inline-block",
                    marginTop: 6,
                    fontSize: 11.5,
                    color: "var(--fg-4)",
                    background: "var(--bg-2, #f8f9fa)",
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                    padding: "2px 7px",
                  }}
                >
                  {m.where}
                </code>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
