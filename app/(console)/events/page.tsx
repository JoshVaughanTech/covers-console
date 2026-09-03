"use client";

import { useMemo, useState } from "react";
import {
  Card,
  Bar,
  Badge,
  Avatar,
  AvatarStack,
  Button,
  Icon,
  Tabs,
  SearchInput,
  Pagination,
  Modal,
  Field,
  TextField,
  Select,
  EmptyState,
  useToast,
} from "@/components/ui";
import type { Tone } from "@/lib/status";
import { SEED_EVENTS, type EventBooking, type EventStatus } from "@/lib/events";
import { PageHead, CardHead } from "@/components/screen/page-head";

/* ============================================================
   Events — hospitality engagements (an event groups the
   shifts/roles for a venue or off-premise site over a date range).
   Interactive: status tabs + search filter, paginated table,
   row -> detail modal, and a New Event form modal.
   ============================================================ */


const STATUS_TONE: Record<EventStatus, Tone> = {
  Active: "success",
  Scheduled: "info",
  "On Hold": "warning",
  Completed: "neutral",
};

const STATUS_OPTIONS = ["Active", "Scheduled", "On Hold", "Completed"] as const;


const PAGE_SIZE = 6;

const blankDraft = () => ({
  name: "",
  site: "",
  client: "",
  status: "Active" as EventStatus,
  start: "",
  end: "",
  required: "",
});

function pct(filled: number, required: number) {
  if (required <= 0) return 0;
  return Math.round((filled / required) * 100);
}

function fillTone(filled: number, required: number): string {
  const r = pct(filled, required);
  if (r >= 95) return "var(--success)";
  if (r >= 70) return "var(--warning)";
  return "var(--danger)";
}

const TH: React.CSSProperties = {
  textAlign: "left",
  padding: "8px 14px",
  fontSize: 10.5,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: ".04em",
  color: "var(--fg-4)",
};

export default function JobsPage() {
  const toast = useToast();
  const [events, setEvents] = useState<EventBooking[]>(SEED_EVENTS);
  const [tab, setTab] = useState("All");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [active, setActive] = useState<EventBooking | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [draft, setDraft] = useState(blankDraft);

  const tabs = ["All", "Active", "Scheduled", "On Hold", "Completed"];

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return events.filter((j) => {
      if (tab !== "All" && j.status !== tab) return false;
      if (!q) return true;
      return (
        j.name.toLowerCase().includes(q) ||
        j.site.toLowerCase().includes(q) ||
        j.client.toLowerCase().includes(q) ||
        j.id.toLowerCase().includes(q)
      );
    });
  }, [events, tab, query]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const metrics = useMemo(() => {
    const activeEvents = events.filter((j) => j.status === "Active").length;
    const openShifts = events.reduce(
      (sum, j) => (j.status === "Active" || j.status === "Scheduled" ? sum + Math.max(0, j.required - j.filled) : sum),
      0
    );
    const unfilledRoles = events.filter(
      (j) => (j.status === "Active" || j.status === "Scheduled") && j.filled < j.required
    ).length;
    const completed = events.filter((j) => j.status === "Completed").length;
    return { activeEvents, openShifts, unfilledRoles, completed };
  }, [events]);

  const resetToFirstPage = () => setPage(1);

  function openEvent(ev: EventBooking) {
    setActive(ev);
  }

  const draftValid =
    draft.name.trim() !== "" &&
    draft.site.trim() !== "" &&
    draft.client.trim() !== "" &&
    Number(draft.required) > 0;

  function createEvent() {
    if (!draftValid) {
      toast("Please complete the required fields", { tone: "warning", icon: "triangle-alert" });
      return;
    }
    const required = Math.max(1, Math.round(Number(draft.required)));
    const next: EventBooking = {
      id: `EVT-${2060 + events.length}`,
      name: draft.name.trim(),
      site: draft.site.trim(),
      client: draft.client.trim(),
      status: draft.status,
      start: draft.start.trim() || "TBC",
      end: draft.end.trim() || "TBC",
      filled: 0,
      required,
      progress: draft.status === "Completed" ? 100 : 0,
      crew: [],
      requirements: [],
    };
    setEvents((prev) => [next, ...prev]);
    setCreateOpen(false);
    setDraft(blankDraft());
    setTab("All");
    setQuery("");
    setPage(1);
    toast(`Event ${next.id} created`, { tone: "success", icon: "circle-check" });
  }

  return (
    <div>
      <PageHead
        title="Events"
        sub="Events and catering engagements across your venues and off-premise sites — coverage, staffing and progress at a glance."
        right={
          <Button size="sm" icon="plus" onClick={() => setCreateOpen(true)}>
            New Event
          </Button>
        }
      />

      {/* Metric row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16, marginBottom: 16 }}>
        <Card pad={18}>
          <div style={{ fontSize: 13, color: "var(--fg-3)", fontWeight: 600 }}>Active Events</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 4 }}>
            <span className="fs-tnum" style={{ fontSize: 34, fontWeight: 800, letterSpacing: "-.02em", color: "var(--fg-1)" }}>
              {metrics.activeEvents}
            </span>
            <Badge tone="success" dot>
              Live
            </Badge>
          </div>
          <div style={{ fontSize: 11.5, color: "var(--fg-4)", marginTop: 4 }}>Currently staffing</div>
        </Card>
        <Card pad={18}>
          <div style={{ fontSize: 13, color: "var(--fg-3)", fontWeight: 600 }}>Open Shifts</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 4 }}>
            <span className="fs-tnum" style={{ fontSize: 34, fontWeight: 800, letterSpacing: "-.02em", color: "var(--warning-fg)" }}>
              {metrics.openShifts}
            </span>
            <Badge tone="warning" dot>
              Needs fill
            </Badge>
          </div>
          <div style={{ fontSize: 11.5, color: "var(--fg-4)", marginTop: 4 }}>Across active &amp; scheduled</div>
        </Card>
        <Card pad={18}>
          <div style={{ fontSize: 13, color: "var(--fg-3)", fontWeight: 600 }}>Unfilled Roles</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 4 }}>
            <span className="fs-tnum" style={{ fontSize: 34, fontWeight: 800, letterSpacing: "-.02em", color: "var(--fg-1)" }}>
              {metrics.unfilledRoles}
            </span>
            <span style={{ fontSize: 14, color: "var(--fg-3)", fontWeight: 600 }}>events</span>
          </div>
          <div style={{ fontSize: 11.5, color: "var(--fg-4)", marginTop: 4 }}>Below required headcount</div>
        </Card>
        <Card pad={18}>
          <div style={{ fontSize: 13, color: "var(--fg-3)", fontWeight: 600 }}>Completed this month</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 4 }}>
            <span className="fs-tnum" style={{ fontSize: 34, fontWeight: 800, letterSpacing: "-.02em", color: "var(--fg-1)" }}>
              {metrics.completed}
            </span>
            <Badge tone="teal" dot>
              Closed
            </Badge>
          </div>
          <div style={{ fontSize: 11.5, color: "var(--fg-4)", marginTop: 4 }}>Delivered &amp; archived</div>
        </Card>
      </div>

      {/* Filter row + table */}
      <Card pad={0}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "14px 18px",
            borderBottom: "1px solid var(--border)",
            flexWrap: "wrap",
          }}
        >
          <Tabs
            tabs={tabs}
            value={tab}
            onChange={(v) => {
              setTab(v);
              resetToFirstPage();
            }}
          />
          <div style={{ flex: 1 }} />
          <div style={{ width: 280, maxWidth: "100%" }}>
            <SearchInput
              value={query}
              onChange={(v) => {
                setQuery(v);
                resetToFirstPage();
              }}
              placeholder="Search events, venues, clients…"
            />
          </div>
        </div>

        {filtered.length === 0 ? (
          <div style={{ padding: 32 }}>
            <EmptyState
              icon="briefcase"
              title="No events match your filters"
              sub="Try a different status tab or clear the search."
              action={
                <Button
                  variant="sec"
                  size="sm"
                  icon="rotate-ccw"
                  onClick={() => {
                    setTab("All");
                    setQuery("");
                    resetToFirstPage();
                  }}
                >
                  Reset filters
                </Button>
              }
            />
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={TH}>Event</th>
                <th style={TH}>Client</th>
                <th style={TH}>Status</th>
                <th style={TH}>Dates</th>
                <th style={{ ...TH, width: 200 }}>Fill</th>
                <th style={{ ...TH, width: 160 }}>Progress</th>
                <th style={{ ...TH, textAlign: "right" }} />
              </tr>
            </thead>
            <tbody>
              {pageRows.map((j) => {
                const fill = pct(j.filled, j.required);
                return (
                  <tr
                    key={j.id}
                    className="hov-row"
                    onClick={() => openEvent(j)}
                    style={{ borderTop: "1px solid var(--border)", cursor: "pointer" }}
                  >
                    <td style={{ padding: "11px 14px" }}>
                      <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--fg-1)" }}>{j.name}</div>
                      <div style={{ fontSize: 11.5, color: "var(--fg-4)", display: "flex", alignItems: "center", gap: 5, marginTop: 2 }}>
                        <Icon name="map-pin" size={12} color="var(--fg-4)" />
                        {j.site}
                        <span style={{ color: "var(--border-2)" }}>·</span>
                        <span className="fs-tnum">{j.id}</span>
                      </div>
                    </td>
                    <td style={{ padding: "11px 14px", fontSize: 13, color: "var(--fg-2)" }}>{j.client}</td>
                    <td style={{ padding: "11px 14px" }}>
                      <Badge tone={STATUS_TONE[j.status]} dot>
                        {j.status}
                      </Badge>
                    </td>
                    <td style={{ padding: "11px 14px" }}>
                      <div className="fs-tnum" style={{ fontSize: 12.5, color: "var(--fg-2)" }}>{j.start}</div>
                      <div className="fs-tnum" style={{ fontSize: 11.5, color: "var(--fg-4)" }}>→ {j.end}</div>
                    </td>
                    <td style={{ padding: "11px 14px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                        <span className="fs-tnum" style={{ fontSize: 12, fontWeight: 700, color: "var(--fg-1)" }}>
                          {j.filled}/{j.required}
                        </span>
                        <span className="fs-tnum" style={{ fontSize: 11.5, color: "var(--fg-4)" }}>{fill}%</span>
                      </div>
                      <Bar value={fill} color={fillTone(j.filled, j.required)} />
                    </td>
                    <td style={{ padding: "11px 14px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                        <span className="fs-tnum" style={{ fontSize: 11.5, color: "var(--fg-4)" }}>Delivery</span>
                        <span className="fs-tnum" style={{ fontSize: 12, fontWeight: 700, color: "var(--fg-1)" }}>{j.progress}%</span>
                      </div>
                      <Bar value={j.progress} color="var(--fs-teal)" />
                    </td>
                    <td style={{ padding: "11px 14px", textAlign: "right" }}>
                      <Icon name="chevron-right" size={16} color="var(--fg-4)" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {filtered.length > 0 && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "12px 18px",
              borderTop: "1px solid var(--border)",
            }}
          >
            <span style={{ fontSize: 12.5, color: "var(--fg-4)" }}>
              Showing <span className="fs-tnum">{pageRows.length}</span> of{" "}
              <span className="fs-tnum">{filtered.length}</span> events
            </span>
            <div style={{ flex: 1 }} />
            <Pagination page={safePage} total={filtered.length} pageSize={PAGE_SIZE} onChange={setPage} />
          </div>
        )}
      </Card>

      {/* Event detail modal */}
      <Modal
        open={active !== null}
        onClose={() => setActive(null)}
        size="lg"
        title={
          active ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
              {active.name}
              <Badge tone={STATUS_TONE[active.status]} dot>
                {active.status}
              </Badge>
            </span>
          ) : (
            "Event"
          )
        }
        footer={
          active ? (
            <>
              <Button
                variant="sec"
                size="sm"
                icon="users"
                onClick={() => {
                  toast(`Assigning staff to ${active.id}…`, { tone: "teal", icon: "users" });
                }}
              >
                Assign Staff
              </Button>
              {active.status !== "Completed" ? (
                <Button
                  size="sm"
                  icon="circle-check"
                  onClick={() => {
                    setEvents((prev) =>
                      prev.map((j) =>
                        j.id === active.id ? { ...j, status: "Completed", progress: 100 } : j
                      )
                    );
                    setActive((cur) => (cur ? { ...cur, status: "Completed", progress: 100 } : cur));
                    toast(`${active.id} marked complete`, { tone: "success", icon: "circle-check" });
                  }}
                >
                  Mark Complete
                </Button>
              ) : (
                <Button size="sm" variant="sec" icon="archive" onClick={() => setActive(null)}>
                  Close
                </Button>
              )}
            </>
          ) : null
        }
      >
        {active && (
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              <DetailChip icon="building-2" label="Client" value={active.client} />
              <DetailChip icon="map-pin" label="Site" value={active.site} />
              <DetailChip icon="hash" label="Reference" value={active.id} mono />
              <DetailChip icon="calendar" label="Dates" value={`${active.start} → ${active.end}`} mono />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <Card pad={16}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--fg-2)" }}>Headcount</span>
                  <span className="fs-tnum" style={{ fontSize: 12.5, fontWeight: 700, color: "var(--fg-1)" }}>
                    {active.filled}/{active.required}
                  </span>
                </div>
                <Bar value={pct(active.filled, active.required)} color={fillTone(active.filled, active.required)} height={8} />
                <div className="fs-tnum" style={{ fontSize: 11.5, color: "var(--fg-4)", marginTop: 6 }}>
                  {Math.max(0, active.required - active.filled)} roles still open
                </div>
              </Card>
              <Card pad={16}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--fg-2)" }}>Delivery progress</span>
                  <span className="fs-tnum" style={{ fontSize: 12.5, fontWeight: 700, color: "var(--fg-1)" }}>
                    {active.progress}%
                  </span>
                </div>
                <Bar value={active.progress} color="var(--fs-teal)" height={8} />
                <div style={{ fontSize: 11.5, color: "var(--fg-4)", marginTop: 6 }}>
                  Schedule completion to date
                </div>
              </Card>
            </div>

            <div>
              <CardHead
                title="Staff"
                right={<span style={{ fontSize: 11.5, color: "var(--fg-4)" }}>{active.crew.length} assigned</span>}
              />
              {active.crew.length > 0 ? (
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <AvatarStack
                    names={active.crew}
                    size={32}
                    max={6}
                    extra={active.crew.length > 6 ? active.crew.length - 6 : undefined}
                  />
                  <span style={{ fontSize: 12.5, color: "var(--fg-3)" }}>
                    {active.crew.slice(0, 3).join(", ")}
                    {active.crew.length > 3 ? ` +${active.crew.length - 3} more` : ""}
                  </span>
                </div>
              ) : (
                <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--fg-4)" }}>
                  <Avatar name="?" size={30} />
                  No staff assigned yet — use Assign Staff to crew this event.
                </div>
              )}
            </div>

            <div>
              <CardHead title="Requirements" />
              {active.requirements.length > 0 ? (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {active.requirements.map((r) => (
                    <span
                      key={r}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        fontSize: 12.5,
                        fontWeight: 500,
                        color: "var(--fg-2)",
                        background: "var(--surface-2)",
                        border: "1px solid var(--border)",
                        borderRadius: 999,
                        padding: "5px 11px",
                      }}
                    >
                      <Icon name="check" size={13} color="var(--fs-teal)" stroke={2.4} />
                      {r}
                    </span>
                  ))}
                </div>
              ) : (
                <div style={{ fontSize: 12.5, color: "var(--fg-4)" }}>No specific requirements recorded.</div>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* New Event modal */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="New Event"
        footer={
          <>
            <Button variant="sec" size="sm" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" icon="plus" onClick={createEvent}>
              Create Event
            </Button>
          </>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Field label="Event name">
            <TextField
              value={draft.name}
              onChange={(v) => setDraft((d) => ({ ...d, name: v }))}
              placeholder="e.g. Werribee Park Wedding — Saturday"
              icon="briefcase"
            />
          </Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <Field label="Venue / site">
              <TextField
                value={draft.site}
                onChange={(v) => setDraft((d) => ({ ...d, site: v }))}
                placeholder="e.g. Riverside Lodge, Parramatta"
                icon="map-pin"
              />
            </Field>
            <Field label="Client">
              <TextField
                value={draft.client}
                onChange={(v) => setDraft((d) => ({ ...d, client: v }))}
                placeholder="e.g. Riverside Health Group"
                icon="building-2"
              />
            </Field>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <Field label="Status">
              <Select
                value={draft.status}
                onChange={(v) => setDraft((d) => ({ ...d, status: v as EventStatus }))}
                options={STATUS_OPTIONS.map((s) => ({ label: s, value: s }))}
              />
            </Field>
            <Field label="Required headcount" hint="Number of roles to staff">
              <TextField
                value={draft.required}
                onChange={(v) => setDraft((d) => ({ ...d, required: v.replace(/[^0-9]/g, "") }))}
                placeholder="e.g. 20"
                type="text"
                icon="users"
              />
            </Field>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <Field label="Start date" hint="Optional">
              <TextField
                value={draft.start}
                onChange={(v) => setDraft((d) => ({ ...d, start: v }))}
                placeholder="e.g. May 01, 2026"
                icon="calendar"
              />
            </Field>
            <Field label="End date" hint="Optional">
              <TextField
                value={draft.end}
                onChange={(v) => setDraft((d) => ({ ...d, end: v }))}
                placeholder="e.g. Jul 31, 2026"
                icon="calendar"
              />
            </Field>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function DetailChip({
  icon,
  label,
  value,
  mono,
}: {
  icon: string;
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 9,
        padding: "8px 12px",
        background: "var(--surface-2)",
        border: "1px solid var(--border)",
        borderRadius: 10,
      }}
    >
      <Icon name={icon} size={15} color="var(--fs-teal)" />
      <div>
        <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".03em", color: "var(--fg-4)" }}>
          {label}
        </div>
        <div className={mono ? "fs-tnum" : undefined} style={{ fontSize: 12.5, fontWeight: 600, color: "var(--fg-1)" }}>
          {value}
        </div>
      </div>
    </div>
  );
}
