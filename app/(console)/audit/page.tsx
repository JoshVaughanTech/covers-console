"use client";

import { useMemo, useState } from "react";
import { Card, Badge, Button, Icon, Avatar, Tabs, useToast } from "@/components/ui";
import type { Tone } from "@/lib/status";
import {
  useIdara,
  verifyChain,
  shortHash,
  HASH_ALGORITHM,
  type AuditEvent,
} from "@/lib/idara";
import { PageHead } from "@/components/screen/page-head";
import { fmtDate } from "./format";

interface EventMeta {
  icon: string;
  tone: Tone;
  kind: string;
}
function eventMeta(e: AuditEvent): EventMeta {
  switch (e.type) {
    case "roster.published":
      return e.data.published
        ? { icon: "calendar-check", tone: "success", kind: "Roster published" }
        : { icon: "calendar-x", tone: "danger", kind: "Publish blocked" };
    case "decision":
      return { icon: "shield-alert", tone: "danger", kind: "Eligibility decision" };
    case "credential.issued":
      return { icon: "badge-check", tone: "success", kind: "Credential issued" };
    case "credential.revoked":
      return { icon: "shield-off", tone: "danger", kind: "Credential revoked" };
    case "shift.assigned":
      return { icon: "user-check", tone: "success", kind: "Shift assigned" };
    /* A claim is a request and an assignment is a decision — labelling both
       "Event" made the two indistinguishable in the trail, which is most of
       what this screen is for. */
    case "shift.claimed":
      return { icon: "hand", tone: "info", kind: "Shift claimed" };
    case "shift.posted":
      return { icon: "megaphone", tone: "neutral", kind: "Shift posted" };
    case "auth.signed_in":
      return { icon: "log-in", tone: "neutral", kind: "Signed in" };
    case "report.delivered":
      return { icon: "file-check", tone: "success", kind: "Report delivered" };
    case "break.pushed":
      return { icon: "circle-check", tone: "success", kind: "Break confirmed" };
    case "break.push_failed":
      return { icon: "triangle-alert", tone: "danger", kind: "Break not recorded" };
    case "break.decision":
      return e.data.overdue
        ? { icon: "coffee", tone: "warning", kind: "Break sent (late)" }
        : { icon: "coffee", tone: "info", kind: "Break sent" };
    default:
      return { icon: "dot", tone: "neutral", kind: "Event" };
  }
}

const TABS = ["All", "Publishes", "Decisions", "Credentials"] as const;
type TabKey = (typeof TABS)[number];

function matchesTab(e: AuditEvent, tab: TabKey): boolean {
  if (tab === "All") return true;
  if (tab === "Publishes") return e.type === "roster.published";
  if (tab === "Decisions") return e.type === "decision";
  return e.type.startsWith("credential.");
}

export default function AuditPage() {
  const toast = useToast();
  const { auditLog, worker } = useIdara();
  const [tab, setTab] = useState<TabKey>("All");

  const chain = useMemo(() => verifyChain(auditLog), [auditLog]);

  const stats = useMemo(() => {
    const publishes = auditLog.filter((e) => e.type === "roster.published" && e.data.published).length;
    const blocked = auditLog.filter(
      (e) => e.type === "decision" || (e.type === "roster.published" && !e.data.published),
    ).length;
    const credentials = auditLog.filter((e) => e.type.startsWith("credential.")).length;
    return { publishes, blocked, credentials };
  }, [auditLog]);

  // newest first
  const events = useMemo(
    () => auditLog.filter((e) => matchesTab(e, tab)).slice().reverse(),
    [auditLog, tab],
  );

  const subjectName = (e: AuditEvent) =>
    e.subject ? worker(e.subject)?.name ?? e.subject : null;

  const runVerify = () => {
    const r = verifyChain(auditLog);
    if (r.ok) {
      toast(`${HASH_ALGORITHM} chain verified — ${auditLog.length} events intact, no tampering`, {
        tone: "success",
        icon: "shield-check",
      });
    } else {
      toast(`Chain broken at event #${r.brokenAt}`, { tone: "danger", icon: "shield-alert" });
    }
  };

  const renderDetails = (e: AuditEvent) => {
    if (e.type === "decision") {
      const reasons = (e.data.reasons as { detail: string }[] | undefined) ?? [];
      if (!reasons.length) return null;
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 8 }}>
          {reasons.map((r, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--fg-2)" }}>
              <span style={{ width: 6, height: 6, borderRadius: 999, background: "var(--danger)", flexShrink: 0 }} />
              {r.detail}
            </div>
          ))}
        </div>
      );
    }
    if (e.type === "roster.published") {
      const warnings = Number(e.data.warnings ?? 0);
      const text = e.data.published
        ? `${Number(e.data.eligible ?? 0)} workers verified · all eligible${warnings ? ` · ${warnings} warning(s)` : ""}`
        : `${Number(e.data.blocked ?? 0)} ineligible worker(s) · publish refused`;
      return <div style={{ fontSize: 12, color: "var(--fg-3)", marginTop: 6 }}>{text}</div>;
    }
    if (e.type.startsWith("credential.")) {
      const t = String(e.data.type ?? "");
      const reason = e.data.reason ? ` · ${String(e.data.reason)}` : "";
      return <div style={{ fontSize: 12, color: "var(--fg-3)", marginTop: 6 }}>{t}{reason}</div>;
    }
    return null;
  };

  const metrics: [string, string, string, string][] = [
    ["Total Events", String(auditLog.length), "scroll-text", "var(--fs-teal)"],
    ["Verified Publishes", String(stats.publishes), "calendar-check", "var(--success)"],
    ["Blocked / Decisions", String(stats.blocked), "shield-alert", "var(--danger)"],
    ["Credential Changes", String(stats.credentials), "badge-check", "var(--info)"],
  ];

  return (
    <div>
      <PageHead
        title="Audit Log"
        sub="Every credential, eligibility decision and publish — hash-chained and tamper-evident by Idara."
        right={
          <Button variant="sec" size="sm" icon="shield-check" onClick={runVerify}>
            Verify integrity
          </Button>
        }
      />

      {/* Integrity banner */}
      <Card
        pad={14}
        style={{
          marginBottom: 16,
          display: "flex",
          alignItems: "center",
          gap: 12,
          borderColor: chain.ok ? "var(--success)" : "var(--danger)",
          background: chain.ok ? "var(--success-bg)" : "var(--danger-bg)",
        }}
      >
        <span
          style={{
            width: 34,
            height: 34,
            borderRadius: 9,
            background: "#fff",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <Icon name={chain.ok ? "shield-check" : "shield-alert"} size={18} color={chain.ok ? "var(--success-fg)" : "var(--danger-fg)"} />
        </span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: chain.ok ? "var(--success-fg)" : "var(--danger-fg)" }}>
            {chain.ok ? "Chain integrity verified" : `Chain broken at event #${chain.brokenAt}`}
          </div>
          <div style={{ fontSize: 12, color: "var(--fg-3)" }}>
            {chain.ok
              ? `All ${auditLog.length} events link to the previous ${HASH_ALGORITHM} hash. Any edit, reorder or deletion would break the chain.`
              : "An event has been altered or removed — the recomputed hash no longer matches."}
          </div>
        </div>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--fg-3)", background: "var(--idara-tint)", padding: "5px 10px", borderRadius: 999 }}>
          <img src="/assets/idara-icon-t.png" alt="" style={{ width: 13, height: 13, objectFit: "contain" }} />
          Idara Core
        </span>
      </Card>

      {/* Metric row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16, marginBottom: 16 }}>
        {metrics.map(([label, val, icon, color]) => (
          <Card key={label} pad={16} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 12.5, color: "var(--fg-3)", fontWeight: 600 }}>{label}</span>
              <span style={{ width: 26, height: 26, borderRadius: 7, background: "var(--bg-2)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                <Icon name={icon} size={14} color={color} />
              </span>
            </div>
            <span className="fs-tnum" style={{ fontSize: 30, fontWeight: 800, letterSpacing: "-.02em" }}>{val}</span>
          </Card>
        ))}
      </div>

      {/* Timeline */}
      <Card pad={0}>
        <div style={{ padding: "16px 20px", display: "flex", alignItems: "center", gap: 12, borderBottom: "1px solid var(--border)" }}>
          <h4 style={{ margin: 0, fontSize: 15.5, flex: 1 }}>Event Trail</h4>
          <Tabs tabs={[...TABS]} value={tab} onChange={(v) => setTab(v as TabKey)} />
        </div>

        {events.length === 0 ? (
          <div style={{ padding: "48px 20px", textAlign: "center", color: "var(--fg-4)", fontSize: 13 }}>
            No events for this filter.
          </div>
        ) : (
          <div style={{ padding: "18px 20px" }}>
            {events.map((e, i) => {
              const m = eventMeta(e);
              const [bg, fg] = [`var(--${m.tone === "neutral" ? "bg-2" : m.tone + "-bg"})`, `var(--${m.tone === "neutral" ? "fg-3" : m.tone + "-fg"})`];
              const name = subjectName(e);
              const isLast = i === events.length - 1;
              return (
                <div key={e.id} style={{ display: "flex", gap: 14 }}>
                  {/* rail */}
                  <div style={{ position: "relative", width: 34, display: "flex", justifyContent: "center", flexShrink: 0 }}>
                    {!isLast && <div style={{ position: "absolute", top: 36, bottom: -2, width: 2, background: "var(--border)" }} />}
                    <span style={{ width: 34, height: 34, borderRadius: 9, background: bg, color: fg, display: "inline-flex", alignItems: "center", justifyContent: "center", zIndex: 1 }}>
                      <Icon name={m.icon} size={17} />
                    </span>
                  </div>
                  {/* content */}
                  <div style={{ flex: 1, paddingBottom: isLast ? 0 : 18, minWidth: 0 }}>
                    <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: "12px 14px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <Badge tone={m.tone}>{m.kind}</Badge>
                        <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--fg-1)", flex: 1, minWidth: 0 }}>{e.summary}</span>
                        <span style={{ fontSize: 11.5, color: "var(--fg-4)", whiteSpace: "nowrap" }}>{fmtDate(e.at)}</span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, fontSize: 11.5, color: "var(--fg-4)" }}>
                        {name && (
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                            <Avatar name={name} size={18} /> {name}
                          </span>
                        )}
                        {name && <span>·</span>}
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                          <Icon name="user" size={12} /> {e.actor}
                        </span>
                      </div>
                      {renderDetails(e)}
                      {/* hash chain footer */}
                      <div className="fs-mono" style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, paddingTop: 9, borderTop: "1px dashed var(--border)", fontSize: 11, color: "var(--fg-4)", flexWrap: "wrap" }}>
                        <span style={{ fontWeight: 700, color: "var(--fg-3)" }}>#{e.seq}</span>
                        <Icon name="hash" size={11} />
                        <span
                          title={`${HASH_ALGORITHM} — ${e.hash}`}
                          style={{ color: "var(--fs-teal-700)" }}
                        >
                          {shortHash(e.hash)}
                        </span>
                        <Icon name="link" size={11} />
                        <span title={`previous event hash — ${e.prevHash}`}>
                          prev {shortHash(e.prevHash)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
