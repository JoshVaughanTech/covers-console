"use client";

import { useMemo, useState } from "react";
import {
  Avatar,
  Badge,
  Bar,
  Button,
  Card,
  Icon,
  Modal,
  Ring,
  Tabs,
  SearchInput,
  Pagination,
  useToast,
} from "@/components/ui";
import type { Tone } from "@/lib/status";
import { PageHead } from "@/components/screen/page-head";
import {
  useIdara,
  LocalCredentialVerifier,
  CREDENTIAL_TYPES,
  standingOf,
  type StandingState,
} from "@/lib/idara";
import { profileOf } from "@/lib/people";
import { FULL_WEEK_HOURS } from "@/lib/matching";

/* ============================================================
   People — workforce directory. Seeded list, tab + search
   filtering, pagination, clickable profile modal, add-person.
   ============================================================ */


/* A person, as the system actually knows them.

   This was a mock, and the dangerous kind: it used the real staff's names
   with attributes invented beside them. Michael Tan appeared with a green
   credential dot while his RSA was revoked in the seed and the engine was
   refusing him. Three others carried the wrong job title, which is not
   cosmetic — functionsForRole() maps a title to the duties a requirement
   binds to, so "Hassan Ali, Kitchen Hand" and "Hassan Ali, Head Chef" are
   different people to the gate.

   A mock with invented names is obviously a mock. One wearing the real
   names reads as the record. */
interface Person {
  did: string;
  name: string;
  role: string;
  /** where they normally work, from their profile */
  siteId: string;
  site: string;
  standing: StandingState;
  /** what is wrong, named rather than coloured */
  issues: string;
  held: number;
  /** each credential they hold, as it verifies today */
  credentials: { label: string; tone: Tone; icon: string }[];
  hoursThisWeek: number;
  rating: number;
}

const STANDING_LABEL: Record<StandingState, string> = {
  current: "Current",
  expiring: "Expiring",
  action_needed: "Action needed",
};

const STANDING_TONE: Record<StandingState, Tone> = {
  current: "success",
  expiring: "warning",
  action_needed: "danger",
};

const RECENT_SHIFTS: [string, string, string][] = [
  ["Mon 2 Jun", "Brightwater Hotel", "7:00am – 3:30pm"],
  ["Fri 30 May", "Brightwater Hotel", "6:30am – 3:00pm"],
  ["Thu 29 May", "Northside Tavern", "7:00am – 4:00pm"],
];

const PAGE_SIZE = 8;

const TH: React.CSSProperties = {
  textAlign: "left",
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: ".04em",
  textTransform: "uppercase",
  color: "var(--fg-4)",
  padding: "10px 16px",
};

export default function PeoplePage() {
  const toast = useToast();
  const { workers, credentials, sites, today } = useIdara();
  const verifier = useMemo(() => new LocalCredentialVerifier(), []);

  /* Derived on render from the same records the engine reads, so a revocation
     anywhere in the console shows here without a refresh — and cannot show
     something different from what the gate would say. */
  const people = useMemo<Person[]>(() => {
    const siteName = new Map(sites.map((s) => [s.id, s.name]));
    return workers.map((w) => {
      const profile = profileOf(w.did);
      const standing = standingOf(w.did, credentials, today, verifier);
      const issues = standing.problems
        .map((h) => `${CREDENTIAL_TYPES[h.credential.type].shortLabel} ${h.state.replace("_", " ")}`)
        .join(" · ");

      return {
        did: w.did,
        name: w.name,
        role: w.role,
        siteId: profile?.homeSiteId ?? "",
        site: siteName.get(profile?.homeSiteId ?? "") ?? "—",
        standing: standing.state,
        issues: issues || "—",
        held: standing.held.length,
        credentials: standing.held.map((h) => ({
          label: CREDENTIAL_TYPES[h.credential.type].shortLabel,
          icon: CREDENTIAL_TYPES[h.credential.type].icon,
          tone: (h.state === "current" ? "success" : h.state === "expiring" ? "warning" : "danger") as Tone,
        })),
        hoursThisWeek: profile?.hoursThisWeek ?? 0,
        rating: profile?.rating ?? 0,
      };
    });
  }, [workers, credentials, sites, today, verifier]);
  const [tab, setTab] = useState("All");

  /* Filtering by home site rather than an invented employment status: it is
     the one grouping the profile data actually carries, and it is the
     question a multi-venue operator asks of a roster. */
  const siteTabs = useMemo(
    () => ["All", ...Array.from(new Set(people.map((x) => x.site))).sort()],
    [people],
  );
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Person | null>(null);

  const metrics = useMemo(() => {
    const total = people.length;
    const current = people.filter((p) => p.standing === "current").length;
    const alerts = people.filter((p) => p.standing === "action_needed").length;
    const hours = people.reduce((n, x) => n + x.hoursThisWeek, 0);
    return { total, current, alerts, hours };
  }, [people]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return people.filter((p) => {
      if (tab !== "All" && p.site !== tab) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.role.toLowerCase().includes(q) ||
        p.site.toLowerCase().includes(q)
      );
    });
  }, [people, tab, query]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const paged = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const resetFilters = (next: () => void) => {
    next();
    setPage(1);
  };

  const metricCards: [string, number, string, string, string][] = [
    ["Total Workforce", metrics.total, "users", "var(--fs-teal)", "people on record"],
    ["Credentials Current", metrics.current, "user-check", "var(--success)", "nothing expiring or lapsed"],
    ["Rostered This Week", metrics.hours, "clock", "var(--info)", "hours across the roster"],
    ["Credential Alerts", metrics.alerts, "shield-alert", "var(--warning)", "need attention"],
  ];

  return (
    <div>
      <PageHead
        title="People"
        sub="Everyone on the books, with what they hold and how the week is loaded."
        right={
          <Button icon="scan-search" onClick={() => toast(`${people.length} staff on record · ${metrics.alerts} need attention`, { tone: metrics.alerts ? "warning" : "success" })}>
            Check credentials
          </Button>
        }
      />

      {/* Metric row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16, marginBottom: 16 }}>
        {metricCards.map(([label, val, icon, color, sub]) => (
          <Card key={label} pad={16} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 12.5, color: "var(--fg-3)", fontWeight: 600 }}>{label}</span>
              <span
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 7,
                  background: "var(--bg-2)",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Icon name={icon} size={14} color={color} />
              </span>
            </div>
            <span className="fs-tnum" style={{ fontSize: 30, fontWeight: 800, letterSpacing: "-.02em" }}>
              {val}
            </span>
            <span style={{ fontSize: 11.5, color: "var(--fg-4)" }}>{sub}</span>
          </Card>
        ))}
      </div>

      {/* Directory */}
      <Card pad={0}>
        <div
          style={{
            padding: "16px 20px",
            display: "flex",
            alignItems: "center",
            gap: 12,
            borderBottom: "1px solid var(--border)",
            flexWrap: "wrap",
          }}
        >
          <Tabs
            tabs={siteTabs}
            value={tab}
            onChange={(v) => resetFilters(() => setTab(v))}
          />
          <div style={{ flex: 1 }} />
          <div style={{ width: 280, maxWidth: "100%" }}>
            <SearchInput
              value={query}
              onChange={(v) => resetFilters(() => setQuery(v))}
              placeholder="Search name, role or site…"
            />
          </div>
        </div>

        {paged.length === 0 ? (
          <div
            style={{
              padding: "48px 20px",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 8,
              textAlign: "center",
            }}
          >
            <span
              style={{
                width: 44,
                height: 44,
                borderRadius: 12,
                background: "var(--bg-2)",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Icon name="users" size={20} color="var(--fg-4)" />
            </span>
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--fg-1)" }}>No people found</div>
            <div style={{ fontSize: 13, color: "var(--fg-4)" }}>
              Try a different search or filter.
            </div>
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr>
                <th style={TH}>Person</th>
                <th style={TH}>Held</th>
                <th style={TH}>Home site</th>
                <th style={TH}>This week</th>
                <th style={TH}>Credentials</th>
                <th style={{ ...TH, textAlign: "right" }}>Rating</th>
                <th style={TH}>Status</th>
              </tr>
            </thead>
            <tbody>
              {paged.map((p) => (
                <tr
                  key={p.did}
                  className="hov-row"
                  onClick={() => setSelected(p)}
                  style={{ borderTop: "1px solid var(--border)", cursor: "pointer" }}
                >
                  <td style={{ padding: "11px 16px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                      <Avatar name={p.name} size={30} />
                      <span>
                        <div style={{ fontWeight: 600, color: "var(--fg-1)" }}>{p.name}</div>
                        <div style={{ fontSize: 11, color: "var(--fg-4)" }}>{p.role}</div>
                      </span>
                    </div>
                  </td>
                  <td className="fs-tnum" style={{ padding: "11px 16px", color: "var(--fg-2)" }}>{p.held}</td>
                  <td style={{ padding: "11px 16px", color: "var(--fg-2)" }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                      <Icon name="map-pin" size={13} color="var(--fg-4)" />
                      {p.site}
                    </span>
                  </td>
                  <td className="fs-tnum" style={{ padding: "11px 16px", color: "var(--fg-2)" }}>{p.hoursThisWeek}h</td>
                  <td style={{ padding: "11px 16px" }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <span
                        style={{
                          width: 7,
                          height: 7,
                          borderRadius: 999,
                          background: `var(--${STANDING_TONE[p.standing]})`,
                          flexShrink: 0,
                        }}
                      />
                      <span style={{ color: "var(--fg-2)" }}>{p.issues === "—" ? STANDING_LABEL[p.standing] : p.issues}</span>
                    </span>
                  </td>
                  <td
                    className="fs-tnum"
                    style={{
                      padding: "11px 16px",
                      textAlign: "right",
                      fontWeight: 700,
                      color: "var(--fg-1)",
                    }}
                  >
                    {p.rating.toFixed(1)}
                  </td>
                  <td style={{ padding: "11px 16px" }}>
                    <Badge tone={STANDING_TONE[p.standing]} dot>
                      {STANDING_LABEL[p.standing]}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div
          style={{
            padding: "12px 16px",
            borderTop: "1px solid var(--border)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <span style={{ fontSize: 12, color: "var(--fg-4)" }}>
            {filtered.length} {filtered.length === 1 ? "person" : "people"}
            {tab !== "All" ? ` · ${tab}` : ""}
          </span>
          <Pagination page={safePage} total={filtered.length} pageSize={PAGE_SIZE} onChange={setPage} />
        </div>
      </Card>

      {/* Profile modal */}
      <Modal
        open={selected !== null}
        onClose={() => setSelected(null)}
        title="Worker Profile"
        size="lg"
        footer={
          selected && (
            <>
              <Button
                variant="sec"
                icon="shield-check"
                onClick={() =>
                  toast(`Opened ${selected.name.split(" ")[0]}'s credential record.`, {
                    tone: "info",
                    icon: "shield-check",
                  })
                }
              >
                View credentials
              </Button>
              <Button
                icon="message-square"
                onClick={() =>
                  toast(`Message sent to ${selected.name.split(" ")[0]}.`, {
                    tone: "success",
                    icon: "send",
                  })
                }
              >
                Message
              </Button>
            </>
          )
        }
      >
        {selected && (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <Avatar name={selected.name} size={56} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: "var(--fg-1)" }}>{selected.name}</div>
                <div style={{ fontSize: 13.5, color: "var(--fg-3)", marginTop: 2 }}>
                  {selected.role} · {selected.site}
                </div>
              </div>
              <Badge tone={STANDING_TONE[selected.standing]} dot>
                {STANDING_LABEL[selected.standing]}
              </Badge>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 16 }}>
              {/* Left: contact + role + credentials */}
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div
                  style={{
                    border: "1px solid var(--border)",
                    borderRadius: 12,
                    padding: 14,
                    display: "flex",
                    flexDirection: "column",
                    gap: 10,
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 700, color: "var(--fg-1)" }}>On record</div>
                  {(
                    [
                      ["map-pin", "Home site", selected.site],
                      ["briefcase", "Role", selected.role],
                      ["clock", "Rostered this week", `${selected.hoursThisWeek}h`],
                      ["star", "Rating", selected.rating.toFixed(1)],
                    ] as [string, string, string][]
                  ).map(([icon, label, val]) => (
                    <div key={label} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <Icon name={icon} size={15} color="var(--fg-4)" />
                      <span style={{ fontSize: 12.5, color: "var(--fg-4)", width: 92 }}>{label}</span>
                      <span style={{ fontSize: 13, color: "var(--fg-1)", fontWeight: 500 }}>{val}</span>
                    </div>
                  ))}
                </div>

                <div
                  style={{
                    border: "1px solid var(--border)",
                    borderRadius: 12,
                    padding: 14,
                    display: "flex",
                    flexDirection: "column",
                    gap: 10,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "var(--fg-1)", flex: 1 }}>
                      Credentials
                    </span>
                    <Badge tone={STANDING_TONE[selected.standing]} dot>
                      {STANDING_LABEL[selected.standing]}
                    </Badge>
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {selected.credentials.length === 0 ? (
                      <span style={{ fontSize: 12, color: "var(--fg-4)" }}>Nothing on record.</span>
                    ) : (
                      selected.credentials.map((c, i) => (
                        <Badge key={i} tone={c.tone} icon={c.tone === "success" ? "check" : "alert-triangle"}>
                          {c.label}
                        </Badge>
                      ))
                    )}
                  </div>
                </div>
              </div>

              {/* Right: fairness */}
              <div
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: 12,
                  padding: 14,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--fg-1)", alignSelf: "flex-start" }}>
                  Hours this week
                </div>
                {(() => {
                  const pct = Math.min(100, (selected.hoursThisWeek / FULL_WEEK_HOURS) * 100);
                  const colour =
                    selected.hoursThisWeek >= FULL_WEEK_HOURS ? "var(--warning)" : "var(--fs-teal)";
                  return (
                    <>
                      <Ring
                        value={pct}
                        size={104}
                        color={colour}
                        label={`${selected.hoursThisWeek}h`}
                        sub={`of ${FULL_WEEK_HOURS}h`}
                      />
                      <div style={{ width: "100%" }}>
                        <Bar value={pct} color={colour} />
                      </div>
                    </>
                  );
                })()}
                <div style={{ fontSize: 11.5, color: "var(--fg-4)", textAlign: "center" }}>
                  Already rostered this week. Past a full week the matcher scores
                  further shifts as overtime risk rather than spare capacity.
                </div>
              </div>
            </div>

            {/* Recent shifts */}
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--fg-1)", marginBottom: 8 }}>
                Recent shifts
              </div>
              <div style={{ border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
                {RECENT_SHIFTS.map(([date, site, hours], i) => (
                  <div
                    key={date}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "10px 14px",
                      borderTop: i ? "1px solid var(--border)" : 0,
                    }}
                  >
                    <Icon name="calendar" size={15} color="var(--fg-4)" />
                    <span style={{ fontSize: 13, fontWeight: 600, color: "var(--fg-1)", width: 96 }}>{date}</span>
                    <span style={{ fontSize: 13, color: "var(--fg-2)", flex: 1 }}>{site}</span>
                    <span className="fs-tnum" style={{ fontSize: 12.5, color: "var(--fg-3)" }}>
                      {hours}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* Add person modal */}
    </div>
  );
}
