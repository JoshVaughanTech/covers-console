"use client";

import { useState } from "react";
import {
  Card,
  Ring,
  Bar,
  Spark,
  Badge,
  Icon,
  Button,
  Modal,
  Field,
  Select,
  Tabs,
  useToast,
} from "@/components/ui";
import { CardHead, LinkBtn, PageHead } from "@/components/screen/page-head";

/* ============================================================
   Reports — range-driven analytics module. All KPI cards and
   the Fairness / Labour visuals re-read from per-range datasets
   held in state, so switching the range updates every number.
   ============================================================ */

type Range = "7 days" | "30 days" | "Quarter" | "YTD";
const RANGES: Range[] = ["7 days", "30 days", "Quarter", "YTD"];

interface Kpi {
  label: string;
  value: string;
  unit?: string;
  trend: string;
  trendUp: boolean;
  spark: number[];
  accent: string;
}

interface SiteCost {
  site: string;
  actual: number; // $k
  budget: number; // $k
}

interface RangeData {
  kpis: Kpi[];
  fairness: { team: number[]; site: number[]; company: number[] };
  fairnessLabels: string[];
  labour: SiteCost[];
  overtime: { site: string; hours: number }[];
}

/* ------------------------------------------------------------
   Per-range datasets. Each range carries its own KPI numbers,
   fairness series, labour-vs-budget bars and overtime split.
   ------------------------------------------------------------ */
const DATA: Record<Range, RangeData> = {
  "7 days": {
    kpis: [
      { label: "Avg Fairness", value: "88", unit: "%", trend: "+6pp", trendUp: true, spark: [80, 82, 81, 84, 85, 87, 88], accent: "var(--success-fg)" },
      { label: "Labour Cost", value: "$184k", trend: "+2.1%", trendUp: false, spark: [24, 26, 25, 27, 28, 26, 28], accent: "var(--fg-1)" },
      { label: "Attendance Rate", value: "94", unit: "%", trend: "+1.3pp", trendUp: true, spark: [90, 91, 93, 92, 94, 93, 94], accent: "var(--success-fg)" },
      { label: "Overtime Hours", value: "126", unit: "h", trend: "-8h", trendUp: true, spark: [22, 20, 19, 18, 17, 16, 14], accent: "var(--fg-1)" },
    ],
    fairnessLabels: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    fairness: {
      team: [80, 82, 81, 84, 85, 87, 88],
      site: [76, 78, 79, 80, 82, 83, 84],
      company: [83, 84, 84, 85, 86, 87, 88],
    },
    labour: [
      { site: "Brisbane", actual: 52, budget: 50 },
      { site: "Sydney", actual: 48, budget: 52 },
      { site: "Melbourne", actual: 44, budget: 42 },
      { site: "Perth", actual: 26, budget: 30 },
      { site: "Adelaide", actual: 14, budget: 16 },
    ],
    overtime: [
      { site: "Brisbane", hours: 42 },
      { site: "Sydney", hours: 31 },
      { site: "Melbourne", hours: 28 },
      { site: "Perth", hours: 15 },
      { site: "Adelaide", hours: 10 },
    ],
  },
  "30 days": {
    kpis: [
      { label: "Avg Fairness", value: "85", unit: "%", trend: "+4pp", trendUp: true, spark: [78, 80, 79, 82, 83, 84, 85], accent: "var(--success-fg)" },
      { label: "Labour Cost", value: "$742k", trend: "+3.4%", trendUp: false, spark: [22, 24, 26, 25, 27, 28, 30], accent: "var(--fg-1)" },
      { label: "Attendance Rate", value: "92", unit: "%", trend: "+0.8pp", trendUp: true, spark: [88, 89, 90, 91, 91, 92, 92], accent: "var(--success-fg)" },
      { label: "Overtime Hours", value: "514", unit: "h", trend: "-22h", trendUp: true, spark: [120, 116, 112, 108, 104, 100, 96], accent: "var(--fg-1)" },
    ],
    fairnessLabels: ["W1", "W2", "W3", "W4"],
    fairness: {
      team: [78, 81, 83, 85],
      site: [74, 77, 80, 82],
      company: [80, 82, 84, 85],
    },
    labour: [
      { site: "Brisbane", actual: 208, budget: 200 },
      { site: "Sydney", actual: 192, budget: 208 },
      { site: "Melbourne", actual: 176, budget: 168 },
      { site: "Perth", actual: 104, budget: 120 },
      { site: "Adelaide", actual: 62, budget: 64 },
    ],
    overtime: [
      { site: "Brisbane", hours: 168 },
      { site: "Sydney", hours: 124 },
      { site: "Melbourne", hours: 112 },
      { site: "Perth", hours: 64 },
      { site: "Adelaide", hours: 46 },
    ],
  },
  Quarter: {
    kpis: [
      { label: "Avg Fairness", value: "83", unit: "%", trend: "+9pp", trendUp: true, spark: [72, 75, 77, 79, 80, 82, 83], accent: "var(--success-fg)" },
      { label: "Labour Cost", value: "$2.21m", trend: "+5.2%", trendUp: false, spark: [60, 64, 68, 70, 74, 76, 80], accent: "var(--fg-1)" },
      { label: "Attendance Rate", value: "91", unit: "%", trend: "+2.1pp", trendUp: true, spark: [86, 87, 88, 89, 90, 90, 91], accent: "var(--success-fg)" },
      { label: "Overtime Hours", value: "1,540", unit: "h", trend: "-110h", trendUp: true, spark: [320, 312, 300, 288, 272, 260, 248], accent: "var(--fg-1)" },
    ],
    fairnessLabels: ["Apr", "May", "Jun"],
    fairness: {
      team: [77, 81, 83],
      site: [73, 78, 82],
      company: [79, 82, 84],
    },
    labour: [
      { site: "Brisbane", actual: 624, budget: 600 },
      { site: "Sydney", actual: 576, budget: 624 },
      { site: "Melbourne", actual: 528, budget: 504 },
      { site: "Perth", actual: 312, budget: 360 },
      { site: "Adelaide", actual: 186, budget: 192 },
    ],
    overtime: [
      { site: "Brisbane", hours: 504 },
      { site: "Sydney", hours: 372 },
      { site: "Melbourne", hours: 336 },
      { site: "Perth", hours: 192 },
      { site: "Adelaide", hours: 136 },
    ],
  },
  YTD: {
    kpis: [
      { label: "Avg Fairness", value: "81", unit: "%", trend: "+12pp", trendUp: true, spark: [68, 71, 74, 76, 78, 80, 81], accent: "var(--success-fg)" },
      { label: "Labour Cost", value: "$4.46m", trend: "+6.8%", trendUp: false, spark: [110, 118, 126, 132, 140, 148, 156], accent: "var(--fg-1)" },
      { label: "Attendance Rate", value: "90", unit: "%", trend: "+3.4pp", trendUp: true, spark: [84, 85, 86, 87, 88, 89, 90], accent: "var(--success-fg)" },
      { label: "Overtime Hours", value: "3,120", unit: "h", trend: "-260h", trendUp: true, spark: [640, 620, 600, 580, 540, 510, 480], accent: "var(--fg-1)" },
    ],
    fairnessLabels: ["Q1", "Q2"],
    fairness: {
      team: [75, 81],
      site: [71, 80],
      company: [78, 83],
    },
    labour: [
      { site: "Brisbane", actual: 1248, budget: 1200 },
      { site: "Sydney", actual: 1152, budget: 1248 },
      { site: "Melbourne", actual: 1056, budget: 1008 },
      { site: "Perth", actual: 624, budget: 720 },
      { site: "Adelaide", actual: 372, budget: 384 },
    ],
    overtime: [
      { site: "Brisbane", hours: 1024 },
      { site: "Sydney", hours: 748 },
      { site: "Melbourne", hours: 676 },
      { site: "Perth", hours: 388 },
      { site: "Adelaide", hours: 284 },
    ],
  },
};

type FairnessSeries = "Team" | "Site" | "Company";
const SERIES_COLOR: Record<FairnessSeries, string> = {
  Team: "var(--series-teal)",
  Site: "var(--series-blue)",
  Company: "var(--series-violet)",
};

interface SavedReport {
  id: number;
  name: string;
  type: string;
  generated: string;
  format: string;
}

const INITIAL_SAVED: SavedReport[] = [
  { id: 1, name: "Weekly Fairness Summary", type: "Fairness", generated: "2 Jun 2026", format: "PDF" },
  { id: 2, name: "Labour Cost vs Budget — May", type: "Labour Cost", generated: "31 May 2026", format: "XLSX" },
  { id: 3, name: "Attendance Breakdown Q2", type: "Attendance", generated: "28 May 2026", format: "PDF" },
  { id: 4, name: "Compliance & Credentials Audit", type: "Compliance", generated: "24 May 2026", format: "CSV" },
  { id: 5, name: "Overtime by Site — April", type: "Overtime", generated: "30 Apr 2026", format: "XLSX" },
];

const REPORT_TYPES = ["Fairness", "Labour Cost", "Attendance", "Compliance", "Overtime"];
const FORMATS = ["PDF", "XLSX", "CSV"];

export default function ReportsPage() {
  const toast = useToast();
  const [range, setRange] = useState<Range>("7 days");
  const data = DATA[range];

  /* Fairness chart series toggle (interactive, state-backed) */
  const [series, setSeries] = useState<FairnessSeries>("Team");
  const fairnessData = series === "Team" ? data.fairness.team : series === "Site" ? data.fairness.site : data.fairness.company;

  /* Generate Report modal */
  const [genOpen, setGenOpen] = useState(false);
  const [genType, setGenType] = useState("Fairness");
  const [genRange, setGenRange] = useState<Range>("30 days");
  const [genFormat, setGenFormat] = useState("PDF");

  /* Saved reports (session-persistent: generating prepends one) */
  const [saved, setSaved] = useState<SavedReport[]>(INITIAL_SAVED);

  const labourMax = Math.max(...data.labour.flatMap((s) => [s.actual, s.budget]));
  const overtimeMax = Math.max(...data.overtime.map((s) => s.hours));
  const overtimeTotal = data.overtime.reduce((a, s) => a + s.hours, 0);

  /* Compliance dataset (static — credential coverage snapshot) */
  const credentials: [string, number, string][] = [
    ["White Card", 98, "var(--success)"],
    ["First Aid", 86, "var(--success)"],
    ["Working at Heights", 72, "var(--warning)"],
    ["EWP Licence", 61, "var(--warning)"],
    ["Confined Space", 44, "var(--danger)"],
  ];
  const complianceScore = Math.round(credentials.reduce((a, c) => a + c[1], 0) / credentials.length);

  const handleExport = () => toast("Report exported", { tone: "success", icon: "download" });

  const handleGenerate = () => {
    const next: SavedReport = {
      id: Date.now(),
      name: `${genType} Report — ${genRange}`,
      type: genType,
      generated: "3 Jun 2026",
      format: genFormat,
    };
    setSaved((list) => [next, ...list]);
    setGenOpen(false);
    toast(`${genType} report generated (${genFormat})`, { tone: "teal", icon: "file-check-2" });
  };

  return (
    <div>
      <PageHead
        title="Reports"
        sub="Analytics across fairness, labour cost, attendance and compliance."
        right={
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Tabs tabs={RANGES} value={range} onChange={(v) => setRange(v as Range)} />
            <Button variant="sec" size="sm" icon="download" onClick={handleExport}>
              Export
            </Button>
            <Button variant="pri" size="sm" icon="file-plus" onClick={() => setGenOpen(true)}>
              Generate Report
            </Button>
          </div>
        }
      />

      {/* KPI row — values, trend and spark all re-read from the active range */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16, marginBottom: 16 }}>
        {data.kpis.map((k) => (
          <Card key={k.label} pad={18} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <span style={{ fontSize: 13, color: "var(--fg-3)", fontWeight: 600 }}>{k.label}</span>
            <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
              <span className="fs-tnum" style={{ fontSize: 32, fontWeight: 800, letterSpacing: "-.02em", color: k.accent }}>
                {k.value}
              </span>
              {k.unit && <span style={{ fontSize: 14, color: "var(--fg-3)", fontWeight: 600 }}>{k.unit}</span>}
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 2 }}>
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: k.trendUp ? "var(--success-fg)" : "var(--danger-fg)",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 3,
                }}
              >
                <Icon name={k.trendUp ? "trending-up" : "trending-down"} size={14} />
                {k.trend}
              </span>
              <Spark data={k.spark} color={k.trendUp ? "var(--success)" : "var(--danger)"} width={88} height={26} />
            </div>
          </Card>
        ))}
      </div>

      {/* Fairness Trend + Labour Cost vs Budget */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
        <Card>
          <CardHead
            title="Fairness Trend"
            right={<Tabs tabs={["Team", "Site", "Company"]} value={series} onChange={(v) => setSeries(v as FairnessSeries)} />}
          />
          <div style={{ position: "relative", height: 150 }}>
            <Spark data={fairnessData} color={SERIES_COLOR[series]} width={440} height={140} />
            <span
              style={{
                position: "absolute",
                top: 0,
                right: 0,
                background: SERIES_COLOR[series],
                color: "#fff",
                fontSize: 12,
                fontWeight: 700,
                padding: "3px 8px",
                borderRadius: 6,
              }}
            >
              {fairnessData[fairnessData.length - 1]}%
            </span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 11, color: "var(--fg-4)" }}>
            {data.fairnessLabels.map((l) => (
              <span key={l}>{l}</span>
            ))}
          </div>
          <div style={{ display: "flex", gap: 16, marginTop: 12, fontSize: 12 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--fg-3)" }}>
              <span style={{ width: 8, height: 8, borderRadius: 999, background: SERIES_COLOR[series] }} />
              {series} fairness · {range}
            </span>
          </div>
        </Card>

        <Card>
          <CardHead title="Labour Cost vs Budget" right={<Badge tone="neutral">{range}</Badge>} />
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {data.labour.map((s) => {
              const over = s.actual > s.budget;
              return (
                <div key={s.site}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "var(--fg-1)" }}>{s.site}</span>
                    <span className="fs-tnum" style={{ fontSize: 12.5, color: "var(--fg-3)" }}>
                      ${s.actual}k{" "}
                      <span style={{ color: over ? "var(--danger-fg)" : "var(--success-fg)", fontWeight: 700 }}>
                        / ${s.budget}k
                      </span>
                    </span>
                  </div>
                  <Bar value={(s.actual / labourMax) * 100} color={over ? "var(--danger)" : "var(--success)"} height={8} />
                </div>
              );
            })}
          </div>
          <div style={{ marginTop: 14 }}>
            <LinkBtn onClick={() => toast("Opening labour cost detail", { tone: "info", icon: "external-link" })}>
              View labour cost detail
            </LinkBtn>
          </div>
        </Card>
      </div>

      {/* Attendance breakdown + Compliance + Overtime */}
      <div style={{ display: "grid", gridTemplateColumns: "1.1fr 1.2fr 1.1fr", gap: 16 }}>
        <Card>
          <CardHead title="Attendance Breakdown" right={<Badge tone="neutral">{range}</Badge>} />
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-around", gap: 8 }}>
            <Ring value={Number(data.kpis[2].value)} label={`${data.kpis[2].value}%`} sub="present" size={104} color="var(--success)" />
            <div style={{ display: "flex", flexDirection: "column", gap: 9, fontSize: 12.5, minWidth: 110 }}>
              {([
                ["On time", "var(--success)", `${data.kpis[2].value}%`],
                ["Late", "var(--warning)", "4%"],
                ["Absent", "var(--danger)", "2%"],
              ] as [string, string, string][]).map(([label, color, val]) => (
                <span key={label} style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                  <span style={{ color: "var(--fg-2)", display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 999, background: color }} />
                    {label}
                  </span>
                  <b className="fs-tnum">{val}</b>
                </span>
              ))}
            </div>
          </div>
        </Card>

        <Card>
          <CardHead title="Compliance & Credentials" right={<Badge tone={complianceScore >= 80 ? "success" : "warning"} dot>{complianceScore}% covered</Badge>} />
          <div style={{ display: "flex", gap: 16 }}>
            <Ring value={complianceScore} label={`${complianceScore}%`} sub="coverage" size={96} color={complianceScore >= 80 ? "var(--success)" : "var(--warning)"} />
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 10 }}>
              {credentials.map(([name, pct, color]) => (
                <div key={name}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ fontSize: 12.5, color: "var(--fg-2)" }}>{name}</span>
                    <span className="fs-tnum" style={{ fontSize: 12, fontWeight: 700, color: "var(--fg-2)" }}>{pct}%</span>
                  </div>
                  <Bar value={pct} color={color} height={6} />
                </div>
              ))}
            </div>
          </div>
        </Card>

        <Card>
          <CardHead title="Overtime by Site" right={<span className="fs-tnum" style={{ fontSize: 12, fontWeight: 700, color: "var(--fg-3)" }}>{overtimeTotal}h total</span>} />
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {data.overtime.map((o) => (
              <div key={o.site}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "var(--fg-1)" }}>{o.site}</span>
                  <span className="fs-tnum" style={{ fontSize: 12.5, fontWeight: 700, color: "var(--fg-2)" }}>{o.hours}h</span>
                </div>
                <Bar value={(o.hours / overtimeMax) * 100} color="var(--series-amber)" height={8} />
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Saved Reports */}
      <Card pad={0} style={{ marginTop: 16 }}>
        <div style={{ padding: "16px 20px", display: "flex", alignItems: "center", gap: 12, borderBottom: "1px solid var(--border)" }}>
          <h4 style={{ margin: 0, fontSize: 15.5, flex: 1 }}>Saved Reports</h4>
          <span style={{ fontSize: 12, color: "var(--fg-4)" }}>{saved.length} saved</span>
        </div>
        <table className="fs-tnum" style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr>
              {["Report", "Type", "Generated", "Format", ""].map((h, i) => (
                <th
                  key={h || "actions"}
                  style={{
                    textAlign: i === 4 ? "right" : "left",
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: ".04em",
                    textTransform: "uppercase",
                    color: "var(--fg-4)",
                    padding: "10px 20px",
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {saved.map((r) => (
              <tr key={r.id} style={{ borderTop: "1px solid var(--border)" }} className="hov-row">
                <td style={{ padding: "11px 20px" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 9 }}>
                    <span
                      style={{
                        width: 30,
                        height: 30,
                        borderRadius: 8,
                        background: "var(--fs-teal-tint)",
                        color: "var(--fs-teal-700)",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      <Icon name="file-text" size={16} />
                    </span>
                    <span style={{ fontWeight: 600, color: "var(--fg-1)" }}>{r.name}</span>
                  </span>
                </td>
                <td style={{ padding: "11px 20px" }}>
                  <Badge tone="neutral">{r.type}</Badge>
                </td>
                <td style={{ padding: "11px 20px", color: "var(--fg-2)" }}>{r.generated}</td>
                <td style={{ padding: "11px 20px", color: "var(--fg-2)" }}>{r.format}</td>
                <td style={{ padding: "11px 20px", textAlign: "right" }}>
                  <span style={{ display: "inline-flex", gap: 6, justifyContent: "flex-end" }}>
                    <Button
                      variant="ghost"
                      size="sm"
                      icon="eye"
                      onClick={() => toast(`Viewing ${r.name}`, { tone: "info", icon: "eye" })}
                    >
                      View
                    </Button>
                    <Button
                      variant="sec"
                      size="sm"
                      icon="download"
                      onClick={() => toast(`Downloading ${r.name} (${r.format})`, { tone: "success", icon: "download" })}
                    >
                      Download
                    </Button>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {/* Generate Report modal */}
      <Modal
        open={genOpen}
        onClose={() => setGenOpen(false)}
        title="Generate Report"
        size="sm"
        footer={
          <>
            <Button variant="sec" size="sm" onClick={() => setGenOpen(false)}>
              Cancel
            </Button>
            <Button variant="pri" size="sm" icon="file-plus" onClick={handleGenerate}>
              Generate
            </Button>
          </>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Field label="Report type">
            <Select
              value={genType}
              onChange={setGenType}
              options={REPORT_TYPES.map((t) => ({ label: t, value: t }))}
            />
          </Field>
          <Field label="Date range">
            <Select
              value={genRange}
              onChange={(v) => setGenRange(v as Range)}
              options={RANGES.map((r) => ({ label: r, value: r }))}
            />
          </Field>
          <Field label="Format" hint="Exported file format for the generated report.">
            <Select
              value={genFormat}
              onChange={setGenFormat}
              options={FORMATS.map((f) => ({ label: f, value: f }))}
            />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
