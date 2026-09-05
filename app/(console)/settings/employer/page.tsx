"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Card, Badge, Button, Icon, Switch, Select, useToast } from "@/components/ui";
import { CardHead, PageHead } from "@/components/screen/page-head";

/* ============================================================
   Employment — the venue's side of one-tap.

   The screen a venue sets up once and then stops thinking about.
   Its whole job is to make one question answerable at a glance:
   CAN WE EMPLOY SOMEBODY RIGHT NOW, and if not, what is in the way.

   That answer is computed on every read by profileGaps(), never
   stored. A workers' compensation policy that expired overnight
   makes this screen say so this morning — a "ready" flag written
   when somebody last saved the form would still be green, and the
   next person assigned would be uninsured on a floor.

   The engagement table below it is the record of what the switch
   has actually done: who signed, what was sent to payroll, and
   which pack items left a worker's hands to get there. A venue that
   cannot see that is being asked to trust us with its employment
   obligations, which is the opposite of the argument.
   ============================================================ */

interface Gap {
  code: string;
  detail: string;
  actionable: boolean;
}

interface ConnectorOption {
  id: string;
  label: string;
  note: string;
  available: boolean;
}

interface Profile {
  did: string;
  abn: string;
  legalName: string;
  tradingName: string;
  sites: { id: string; name: string }[];
  payroll: { connector: string; tenantRef: string; connectedAt: string } | null;
  timeClock: { connector: string; timeClockId: string } | null;
  workersComp: { insurer: string; policyRef: string; expiresAt: string };
  awardMode: string;
  classifications: { role: string; level: string | number; stream: string }[];
  agreementTemplateVersion: string;
  signatory: { did: string; name: string };
  acceptsPacks: boolean;
}

interface EmployerPayload {
  at: string;
  profile: Profile;
  profileHash: string;
  gaps: Gap[];
  ready: boolean;
  connectors: ConnectorOption[];
  counts: {
    engagements: number;
    awaitingWorker: number;
    provisioned: number;
    employeesInPayroll: number | null;
  };
}

interface Worked {
  hours: number;
  plannedHours: number;
  varianceHours: number;
  breaksTaken: number;
  clockIn: number;
  clockOut: number;
  loading: { clause: string; minutes: number; estimateCents: number | null } | null;
  cost: { wagesCents: number; superCents: number; bookingFeeCents: number; totalCents: number };
  autoConfirmAt: number;
  dueForAutoConfirm: boolean;
  confirmable: boolean;
}

interface EngagementRow {
  id: string;
  status: string;
  standing: string;
  role: string;
  siteName: string;
  date: string;
  window: string;
  worker: { did: string; name: string; role: string };
  pay: { offeredHourlyCents: number; floorHourlyCents: number; hours: number; estGrossCents: number };
  employment: { first: boolean; claimsTaxFreeThreshold: boolean };
  releases: { item: string; label: string; toConnector: string; at: string }[];
  acceptance: {
    worker: { at: string; eventHash: string } | null;
    employer: { at: string; eventHash: string } | null;
  };
  employerProfileHash: string;
  /** what the time clock says, once the shift has run. */
  worked: Worked | null;
  /** why the clock has nothing to say, when it has nothing. */
  unmatched: string | null;
}

interface ConversionRow {
  workerDid: string;
  workerName: string;
  since: string;
  daysEngaged: number;
  shifts: number;
  state: string;
  detail: string;
}

const aud = (cents: number) => `$${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;

const STATUS_TONE: Record<string, "success" | "info" | "warning" | "neutral" | "danger"> = {
  proposed: "warning",
  accepted: "info",
  provisioned: "success",
  worked: "success",
  confirmed: "success",
  cancelled: "neutral",
};

const STATUS_LABEL: Record<string, string> = {
  proposed: "Waiting on worker",
  accepted: "Signed — payroll pending",
  provisioned: "On payroll",
  worked: "Worked",
  confirmed: "Hours confirmed",
  cancelled: "Cancelled",
};

const dateLabel = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

export default function EmployerSettingsPage() {
  const toast = useToast();
  const [data, setData] = useState<EmployerPayload | null>(null);
  const [engagements, setEngagements] = useState<EngagementRow[]>([]);
  const [conversion, setConversion] = useState<ConversionRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [choice, setChoice] = useState("mock");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/employer");
      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
      const body = (await res.json()) as EmployerPayload;
      setData(body);
      if (body.profile.payroll) setChoice(body.profile.payroll.connector);
      setError(null);

      const eng = await fetch("/api/employer/engagements");
      if (eng.ok) {
        const b = (await eng.json()) as { engagements: EngagementRow[]; conversion: ConversionRow[] };
        setEngagements(b.engagements);
        setConversion(b.conversion);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the employer profile");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Settle one shift's hours.
   *
   * The figure is not sent. The endpoint reads it off the clock itself, so
   * what this button does is agree — which is why the row shows the hours,
   * the variance and the loading before it is pressed. A confirm control that
   * posted a number would make this screen a payroll input form.
   */
  async function confirmHours(e: EngagementRow) {
    setBusy(true);
    try {
      const res = await fetch("/api/engagements/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ engagementId: e.id }),
      });
      const b = await res.json();
      if (!res.ok) throw new Error(b.error ?? `HTTP ${res.status}`);
      toast(
        `${e.worker.name} — ${b.hours}h confirmed${
          b.loading ? `, plus ${b.loading.minutes}m cl 16.6 loading` : ""
        }`,
        { tone: "success", icon: "file-check" },
      );
      await load();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not confirm those hours", {
        tone: "danger",
        icon: "triangle-alert",
      });
    } finally {
      setBusy(false);
    }
  }

  async function post(body: Record<string, unknown>, ok: string) {
    setBusy(true);
    try {
      const res = await fetch("/api/employer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const b = await res.json();
      if (!res.ok) throw new Error(b.error ?? `HTTP ${res.status}`);
      toast(ok, { tone: "success", icon: "check" });
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : "That didn't work", { tone: "danger", icon: "triangle-alert" });
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <>
        <PageHead title="Employment" sub="One-tap employment for this venue" />
        <Card>
          <p style={{ margin: 0, color: "var(--danger-fg)" }}>{error}</p>
        </Card>
      </>
    );
  }

  if (!data) {
    return (
      <>
        <PageHead title="Employment" sub="One-tap employment for this venue" />
        <Card>
          <p style={{ margin: 0, color: "var(--fg-3)" }}>Loading…</p>
        </Card>
      </>
    );
  }

  const p = data.profile;

  return (
    <>
      <PageHead
        title="Employment"
        sub={`${p.tradingName} · ABN ${p.abn}`}
        right={
          <Badge tone={data.ready ? "success" : "warning"} icon={data.ready ? "shield-check" : "triangle-alert"}>
            {data.ready ? "Ready to employ" : `${data.gaps.length} thing${data.gaps.length === 1 ? "" : "s"} to fix`}
          </Badge>
        }
      />

      <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}>
        <Card>
          <CardHead title="Can we employ somebody today?" />
          {data.ready ? (
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: "var(--fg-2)" }}>
              Yes. Assign anyone with a complete pack and the engagement assembles itself — rate
              checked against the award, both signatures recorded, and the employee created in your
              payroll with every field pre-filled. Nobody here types anything.
            </p>
          ) : (
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14, lineHeight: 1.7, color: "var(--fg-2)" }}>
              {data.gaps.map((g) => (
                <li key={g.code}>
                  {g.detail}
                  {!g.actionable && (
                    <span style={{ color: "var(--fg-4)" }}> — not something this screen can fix.</span>
                  )}
                </li>
              ))}
            </ul>
          )}

          <div style={{ display: "flex", gap: 20, marginTop: 16, flexWrap: "wrap" }}>
            <Stat label="Engagements" value={String(data.counts.engagements)} />
            <Stat label="Waiting on a signature" value={String(data.counts.awaitingWorker)} />
            <Stat label="On payroll" value={String(data.counts.provisioned)} />
            {data.counts.employeesInPayroll !== null && (
              <Stat label="In the demo payroll" value={String(data.counts.employeesInPayroll)} />
            )}
          </div>

          {/* Counted on the payroll's side, not ours, and that is the point of
              showing it: "on payroll" above is what the chain says happened,
              this is what the payroll actually holds, and the two agreeing is
              the only evidence provisioning worked. The demo payroll keeps its
              employees in memory, so a restarted server legitimately shows
              none — a real connector asks the real system. */}
          {data.counts.employeesInPayroll !== null &&
            data.counts.employeesInPayroll < data.counts.provisioned && (
              <p style={{ margin: "12px 0 0", fontSize: 12.5, color: "var(--fg-4)", lineHeight: 1.5 }}>
                The demo payroll holds its employees in memory and was restarted, so it reports fewer
                than the chain does. Re-accepting an engagement recreates them; a real payroll
                remembers.
              </p>
            )}
        </Card>

        <Card>
          <CardHead
            title="Payroll"
            right={
              p.payroll ? (
                <Badge tone="success" dot>
                  Connected
                </Badge>
              ) : (
                <Badge tone="warning" dot>
                  Not connected
                </Badge>
              )
            }
          />
          <p style={{ margin: "0 0 14px", fontSize: 13.5, lineHeight: 1.6, color: "var(--fg-3)" }}>
            Where employees are created and TFN declarations are lodged. Covers never builds payroll
            and never holds wages — it hands your payroll what a worker&rsquo;s verified pack already
            contains.
          </p>

          <Select
            value={choice}
            onChange={setChoice}
            options={data.connectors.map((c) => ({
              label: c.available ? c.label : `${c.label} — not built yet`,
              value: c.id,
            }))}
          />

          <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            <Button
              disabled={busy}
              onClick={() => void post({ payroll: { connector: choice } }, "Payroll connected")}
            >
              {p.payroll ? "Reconnect" : "Connect"}
            </Button>
            {p.payroll && (
              <Button
                variant="sec"
                disabled={busy}
                onClick={() => void post({ payroll: null }, "Payroll disconnected")}
              >
                Disconnect
              </Button>
            )}
          </div>

          {p.payroll && (
            <p style={{ margin: "12px 0 0", fontSize: 12.5, color: "var(--fg-4)" }}>
              Tenant <code>{p.payroll.tenantRef}</code> · connected {dateLabel(p.payroll.connectedAt)}
              {p.timeClock && ` · time clock ${p.timeClock.connector}`}
            </p>
          )}

          <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
            <Switch
              checked={p.acceptsPacks}
              onChange={(v) => void post({ acceptsPacks: v }, v ? "One-tap employment on" : "One-tap employment off")}
              label="Accept Covers employment packs"
            />
            <p style={{ margin: "8px 0 0", fontSize: 12.5, color: "var(--fg-4)", lineHeight: 1.5 }}>
              Off means assignments still roster people, and no engagement is proposed. Anyone
              already provisioned stays in your payroll.
            </p>
          </div>
        </Card>

        <Card>
          <CardHead title="Legal identity" />
          <Rows
            rows={[
              ["Legal name", p.legalName],
              ["ABN", p.abn],
              ["Award", p.awardMode === "higa" ? "Hospitality (General) MA000009" : p.awardMode],
              ["Workers' comp", `${p.workersComp.insurer} · ${p.workersComp.policyRef}`],
              ["Policy expires", dateLabel(p.workersComp.expiresAt)],
              ["Casual agreement", p.agreementTemplateVersion],
              ["Signed for the venue by", p.signatory.name],
              ["Sites", p.sites.map((s) => s.name).join(", ")],
            ]}
          />
          {/* The hash every engagement pins. Change the payroll connection and
              this changes — which is exactly what makes "signed against this
              profile" a checkable statement rather than a reassuring one. */}
          <p className="fs-tnum" style={{ margin: "12px 0 0", fontSize: 11.5, color: "var(--fg-4)" }}>
            Profile hash {data.profileHash.slice(0, 24)}…
          </p>
        </Card>

        <Card>
          <CardHead title="Award classifications" />
          <p style={{ margin: "0 0 12px", fontSize: 13.5, lineHeight: 1.6, color: "var(--fg-3)" }}>
            Which level each role sits at. Authored here, never guessed — it decides what a shift
            pays, and an engagement for an unclassified role is refused rather than priced at a
            default.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "6px 16px", fontSize: 13.5 }}>
            {p.classifications.map((c) => (
              <div key={c.role} style={{ display: "contents" }}>
                <span style={{ color: "var(--fg-2)" }}>{c.role}</span>
                <span style={{ color: "var(--fg-3)", whiteSpace: "nowrap" }}>
                  Level {String(c.level)} · {c.stream.replace(/_/g, " ")}
                </span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card style={{ marginTop: 16 }}>
        <CardHead
          title="Engagements"
          right={<Link href="/audit" style={{ fontSize: 13, color: "var(--fs-teal)" }}>Audit trail →</Link>}
        />
        {engagements.length === 0 ? (
          <p style={{ margin: 0, fontSize: 14, color: "var(--fg-3)", lineHeight: 1.6 }}>
            None yet. Assign somebody to an open shift and the engagement is proposed automatically —
            it appears here the moment it is.
          </p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
              <thead>
                <tr style={{ textAlign: "left", color: "var(--fg-4)", fontSize: 12 }}>
                  <th style={th}>Worker</th>
                  <th style={th}>Shift</th>
                  <th style={th}>Rate</th>
                  <th style={th}>Hours worked</th>
                  <th style={th}>Released</th>
                  <th style={th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {engagements.map((e) => (
                  <tr key={e.id} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={td}>
                      <strong>{e.worker.name}</strong>
                      <span style={{ display: "block", color: "var(--fg-4)", fontSize: 12 }}>
                        {e.employment.first ? "First engagement here" : "Returning"}
                      </span>
                    </td>
                    <td style={td}>
                      {e.role}
                      <span style={{ display: "block", color: "var(--fg-4)", fontSize: 12 }}>
                        {e.siteName} · {dateLabel(e.date)} · {e.window}
                      </span>
                    </td>
                    <td style={td} className="fs-tnum">
                      {aud(e.pay.offeredHourlyCents)}/h
                      <span style={{ display: "block", color: "var(--fg-4)", fontSize: 12 }}>
                        floor {aud(e.pay.floorHourlyCents)}
                      </span>
                    </td>
                    <td style={td}>
                      <WorkedCell e={e} busy={busy} onConfirm={() => void confirmHours(e)} />
                    </td>
                    <td style={td}>
                      {e.releases.length === 0 ? (
                        <span style={{ color: "var(--fg-4)" }}>—</span>
                      ) : (
                        <span title={e.releases.map((r) => r.label).join(", ")}>
                          {e.releases.length} item{e.releases.length === 1 ? "" : "s"} →{" "}
                          {e.releases[0].toConnector}
                        </span>
                      )}
                    </td>
                    <td style={td}>
                      <Badge tone={STATUS_TONE[e.status] ?? "neutral"} dot>
                        {STATUS_LABEL[e.status] ?? e.status}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card style={{ marginTop: 16 }}>
        <CardHead
          title="Casual conversion"
          right={
            conversion.length > 0 ? (
              <Badge tone="warning" icon="triangle-alert">
                {conversion.length} to review
              </Badge>
            ) : undefined
          }
        />
        <p style={{ margin: "0 0 12px", fontSize: 13.5, lineHeight: 1.6, color: "var(--fg-3)" }}>
          A casual working a regular pattern here for six months can ask to become permanent, and you
          have to answer. Read off the engagement chain — flagged, never decided: whether a pattern
          is regular and systematic is your call, and this only says it is time to make it.
        </p>
        {conversion.length === 0 ? (
          <p style={{ margin: 0, fontSize: 14, color: "var(--fg-3)" }}>
            Nobody is close to the six-month mark on this venue&rsquo;s engagements.
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {conversion.map((c) => (
              <div
                key={c.workerDid}
                style={{ display: "flex", gap: 12, alignItems: "flex-start", fontSize: 13.5 }}
              >
                <Icon name={c.state === "eligible" ? "user-check" : "clock"} size={16} />
                <div>
                  <strong>{c.workerName}</strong>
                  <span style={{ display: "block", color: "var(--fg-3)", lineHeight: 1.5 }}>{c.detail}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}

/* ---------- pieces ---------- */

const th: React.CSSProperties = { padding: "0 12px 8px 0", fontWeight: 600 };
const td: React.CSSProperties = { padding: "10px 12px 10px 0", verticalAlign: "top" };

const UNMATCHED_COPY: Record<string, string> = {
  no_session: "No clock-in against this shift",
  still_open: "Still clocked in",
  ambiguous: "Two possible sessions — settle it in the clock",
};

/**
 * What the clock says, and the button that agrees with it.
 *
 * The hours, the variance against the roster and any cl 16.6 loading are all
 * shown before the button is pressed, because "Confirm" on its own asks
 * somebody to affirm a number they have not been given. The variance is the
 * part a manager actually reads — a shift that ran half an hour long is
 * routine, and one that ran three hours long is a conversation.
 */
function WorkedCell({
  e,
  busy,
  onConfirm,
}: {
  e: EngagementRow;
  busy: boolean;
  onConfirm: () => void;
}) {
  if (!e.worked) {
    /* Before the shift has run there is nothing to say and nothing is said.
       After it has, the reason is the useful part. */
    if (!e.unmatched) return <span style={{ color: "var(--fg-4)" }}>—</span>;
    return (
      <span style={{ color: "var(--warning-fg)", fontSize: 12.5 }}>
        {UNMATCHED_COPY[e.unmatched] ?? e.unmatched}
      </span>
    );
  }

  const w = e.worked;
  const over = w.varianceHours > 0;
  return (
    <div>
      <span className="fs-tnum" style={{ fontWeight: 600 }}>
        {w.hours}h
      </span>
      {w.varianceHours !== 0 && (
        <span
          className="fs-tnum"
          style={{ marginLeft: 6, fontSize: 12, color: over ? "var(--warning-fg)" : "var(--fg-4)" }}
        >
          {over ? "+" : ""}
          {w.varianceHours}h vs roster
        </span>
      )}
      <span style={{ display: "block", fontSize: 12, color: "var(--fg-4)" }}>
        {w.breaksTaken === 0 ? "no breaks taken" : `${w.breaksTaken} break${w.breaksTaken === 1 ? "" : "s"}`}
        {w.loading && ` · cl ${w.loading.clause} ${w.loading.minutes}m owed`}
      </span>

      {w.confirmable ? (
        <>
          <Button size="sm" variant="sec" disabled={busy} onClick={onConfirm} style={{ marginTop: 6 }}>
            Confirm {w.hours}h
          </Button>
          {w.dueForAutoConfirm && (
            <span style={{ display: "block", fontSize: 11.5, color: "var(--warning-fg)", marginTop: 4 }}>
              Past 48h — the next sweep confirms this for you
            </span>
          )}
        </>
      ) : (
        <span style={{ display: "block", fontSize: 12, color: "var(--success-fg)", marginTop: 4 }}>
          Fee {aud(w.cost.bookingFeeCents)} · wages {aud(w.cost.wagesCents)}
        </span>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="fs-tnum" style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-.02em" }}>
        {value}
      </div>
      <div style={{ fontSize: 12, color: "var(--fg-4)" }}>{label}</div>
    </div>
  );
}

function Rows({ rows }: { rows: [string, string][] }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "7px 16px", fontSize: 13.5 }}>
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: "contents" }}>
          <span style={{ color: "var(--fg-4)", whiteSpace: "nowrap" }}>{k}</span>
          <span style={{ color: "var(--fg-2)" }}>{v}</span>
        </div>
      ))}
    </div>
  );
}
