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
  Field,
  TextField,
  Select,
  useToast,
} from "@/components/ui";
import type { Tone } from "@/lib/status";
import { PageHead } from "@/components/screen/page-head";

/* ============================================================
   People — workforce directory. Seeded list, tab + search
   filtering, pagination, clickable profile modal, add-person.
   ============================================================ */

type PersonStatus = "Active" | "On Leave" | "Inactive";
type EmploymentType = "Full-time" | "Part-time" | "Casual" | "Contractor";
type CredStatus = "success" | "warning" | "danger";

interface Person {
  id: number;
  name: string;
  role: string;
  team: string;
  location: string;
  status: PersonStatus;
  type: EmploymentType;
  phone: string;
  cred: CredStatus;
  fairness: number;
  onShift: boolean;
}

const STATUS_TONE: Record<PersonStatus, Tone> = {
  Active: "success",
  "On Leave": "warning",
  Inactive: "neutral",
};

const CRED_LABEL: Record<CredStatus, string> = {
  success: "All current",
  warning: "Expiring soon",
  danger: "Action required",
};

const CRED_COLOR: Record<CredStatus, string> = {
  success: "var(--success)",
  warning: "var(--warning)",
  danger: "var(--danger)",
};

const fairnessColor = (v: number) =>
  v >= 85 ? "var(--success)" : v >= 70 ? "var(--warning)" : "var(--danger)";

const SEED: Person[] = [
  { id: 1, name: "Darie Roberts", role: "Bartender", team: "Bar Team", location: "Brightwater Hotel", status: "Active", type: "Full-time", phone: "0412 884 201", cred: "success", fairness: 92, onShift: true },
  { id: 2, name: "Leanne Vidal", role: "Wait Staff", team: "Floor Team", location: "Brightwater Hotel", status: "Active", type: "Full-time", phone: "0413 220 778", cred: "warning", fairness: 81, onShift: true },
  { id: 3, name: "Mitch Egan", role: "Gaming Attendant", team: "Gaming Team", location: "Northside Tavern", status: "Active", type: "Casual", phone: "0408 551 119", cred: "success", fairness: 88, onShift: true },
  { id: 4, name: "Tahlia Johnson", role: "Barback", team: "Bar Team", location: "Brightwater Hotel", status: "On Leave", type: "Casual", phone: "0420 117 663", cred: "warning", fairness: 74, onShift: false },
  { id: 5, name: "Aaron Patel", role: "Bartender", team: "Bar Team", location: "Brightwater Hotel", status: "Active", type: "Full-time", phone: "0411 905 482", cred: "success", fairness: 90, onShift: true },
  { id: 6, name: "Sophie Nguyen", role: "Venue Manager", team: "Management", location: "Northside Tavern", status: "Active", type: "Full-time", phone: "0414 332 901", cred: "success", fairness: 95, onShift: true },
  { id: 7, name: "Jake Morrison", role: "Bartender", team: "Kitchen Team", location: "Brightwater Hotel", status: "Active", type: "Full-time", phone: "0417 660 224", cred: "danger", fairness: 66, onShift: true },
  { id: 8, name: "Hassan Ali", role: "Kitchen Hand", team: "Gaming Team", location: "Brightwater Hotel", status: "Active", type: "Casual", phone: "0402 778 116", cred: "warning", fairness: 79, onShift: true },
  { id: 9, name: "Josh Williams", role: "Sous Chef", team: "Events Team", location: "Quayside Bar & Kitchen", status: "Active", type: "Contractor", phone: "0419 445 027", cred: "success", fairness: 86, onShift: false },
  { id: 10, name: "Michael Tan", role: "Wait Staff", team: "Floor Team", location: "Quayside Bar & Kitchen", status: "Active", type: "Full-time", phone: "0421 003 558", cred: "success", fairness: 84, onShift: true },
  { id: 11, name: "Priya Sharma", role: "Events Coordinator", team: "Management", location: "Brightwater Hotel", status: "Active", type: "Full-time", phone: "0413 887 440", cred: "success", fairness: 93, onShift: true },
  { id: 12, name: "Liam O'Brien", role: "Barback", team: "Gaming Team", location: "Northside Tavern", status: "Inactive", type: "Casual", phone: "0406 220 119", cred: "danger", fairness: 58, onShift: false },
  { id: 13, name: "Chloe Davis", role: "Barista", team: "Kitchen Team", location: "Brightwater Hotel", status: "Active", type: "Part-time", phone: "0418 552 904", cred: "warning", fairness: 77, onShift: true },
  { id: 14, name: "Noah Wilson", role: "Bartender", team: "Bar Team", location: "Quayside Bar & Kitchen", status: "On Leave", type: "Full-time", phone: "0412 119 887", cred: "success", fairness: 89, onShift: false },
  { id: 15, name: "Emma Brooks", role: "Compliance Officer", team: "Management", location: "Brightwater Hotel", status: "Active", type: "Full-time", phone: "0415 660 332", cred: "success", fairness: 96, onShift: true },
  { id: 16, name: "Ryan Murphy", role: "Gaming Attendant", team: "Gaming Team", location: "Northside Tavern", status: "Active", type: "Casual", phone: "0407 884 551", cred: "warning", fairness: 72, onShift: true },
  { id: 17, name: "Olivia Chen", role: "Wait Staff", team: "Floor Team", location: "Brightwater Hotel", status: "Active", type: "Full-time", phone: "0419 220 663", cred: "success", fairness: 87, onShift: true },
  { id: 18, name: "Daniel Kelly", role: "Sous Chef", team: "Events Team", location: "Quayside Bar & Kitchen", status: "Inactive", type: "Contractor", phone: "0402 551 224", cred: "danger", fairness: 61, onShift: false },
  { id: 19, name: "Grace Taylor", role: "Barback", team: "Kitchen Team", location: "Brightwater Hotel", status: "Active", type: "Casual", phone: "0414 905 117", cred: "success", fairness: 83, onShift: true },
  { id: 20, name: "Ethan Clarke", role: "Venue Manager", team: "Management", location: "Quayside Bar & Kitchen", status: "Active", type: "Full-time", phone: "0411 332 778", cred: "success", fairness: 94, onShift: true },
  { id: 21, name: "Isla Martin", role: "Bartender", team: "Bar Team", location: "Brightwater Hotel", status: "Active", type: "Part-time", phone: "0418 660 901", cred: "warning", fairness: 76, onShift: true },
  { id: 22, name: "Lucas Reed", role: "Kitchen Hand", team: "Gaming Team", location: "Northside Tavern", status: "On Leave", type: "Casual", phone: "0406 778 440", cred: "success", fairness: 85, onShift: false },
  { id: 23, name: "Ava Mitchell", role: "Barista", team: "Kitchen Team", location: "Brightwater Hotel", status: "Active", type: "Casual", phone: "0413 119 558", cred: "success", fairness: 82, onShift: true },
  { id: 24, name: "Mason Hughes", role: "Barback", team: "Bar Team", location: "Quayside Bar & Kitchen", status: "Active", type: "Casual", phone: "0417 220 119", cred: "danger", fairness: 64, onShift: false },
];

const ROLE_OPTIONS = [
  "Bartender",
  "Wait Staff",
  "Sous Chef",
  "Gaming Attendant",
  "Barback",
  "Kitchen Hand",
  "Barista",
  "Venue Manager",
  "Compliance Officer",
  "Events Coordinator",
];

const TYPE_OPTIONS: EmploymentType[] = ["Full-time", "Part-time", "Casual", "Contractor"];

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
  const [people, setPeople] = useState<Person[]>(SEED);
  const [tab, setTab] = useState("All");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Person | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  // Add-person form state
  const [fName, setFName] = useState("");
  const [fRole, setFRole] = useState("");
  const [fTeam, setFTeam] = useState("");
  const [fLocation, setFLocation] = useState("");
  const [fType, setFType] = useState("");

  const metrics = useMemo(() => {
    const total = people.length;
    const onShift = people.filter((p) => p.onShift).length;
    const active = people.filter((p) => p.status === "Active").length;
    const alerts = people.filter((p) => p.cred !== "success").length;
    return { total, onShift, active, alerts };
  }, [people]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return people.filter((p) => {
      if (tab !== "All" && p.status !== tab) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.role.toLowerCase().includes(q) ||
        p.team.toLowerCase().includes(q) ||
        p.location.toLowerCase().includes(q)
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

  const handleAdd = () => {
    if (!fName.trim() || !fRole || !fType) {
      toast("Name, role and employment type are required.", { tone: "warning", icon: "alert-triangle" });
      return;
    }
    const newPerson: Person = {
      id: Math.max(0, ...people.map((p) => p.id)) + 1,
      name: fName.trim(),
      role: fRole,
      team: fTeam.trim() || "Unassigned",
      location: fLocation.trim() || "Brightwater Hotel",
      status: "Active",
      type: fType as EmploymentType,
      phone: "—",
      cred: "warning",
      fairness: 80,
      onShift: false,
    };
    setPeople((list) => [newPerson, ...list]);
    setAddOpen(false);
    setFName("");
    setFRole("");
    setFTeam("");
    setFLocation("");
    setFType("");
    setTab("All");
    setQuery("");
    setPage(1);
    toast(`${newPerson.name} added to the directory.`, { tone: "success", icon: "user-plus" });
  };

  const metricCards: [string, number, string, string, string][] = [
    ["Total Workforce", metrics.total, "users", "var(--fs-teal)", "people on record"],
    ["On Shift Today", metrics.onShift, "hard-hat", "var(--info)", "currently rostered"],
    ["Active", metrics.active, "user-check", "var(--success)", "available to roster"],
    ["Credential Alerts", metrics.alerts, "shield-alert", "var(--warning)", "need attention"],
  ];

  return (
    <div>
      <PageHead
        title="People"
        sub="Your workforce directory — roles, credentials, fairness and availability."
        right={
          <Button icon="user-plus" onClick={() => setAddOpen(true)}>
            Add Person
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
            tabs={["All", "Active", "On Leave", "Inactive"]}
            value={tab}
            onChange={(v) => resetFilters(() => setTab(v))}
          />
          <div style={{ flex: 1 }} />
          <div style={{ width: 280, maxWidth: "100%" }}>
            <SearchInput
              value={query}
              onChange={(v) => resetFilters(() => setQuery(v))}
              placeholder="Search name, role, team…"
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
                <th style={TH}>Team</th>
                <th style={TH}>Location</th>
                <th style={TH}>Type</th>
                <th style={TH}>Credentials</th>
                <th style={{ ...TH, textAlign: "right" }}>Fairness</th>
                <th style={TH}>Status</th>
              </tr>
            </thead>
            <tbody>
              {paged.map((p) => (
                <tr
                  key={p.id}
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
                  <td style={{ padding: "11px 16px", color: "var(--fg-2)" }}>{p.team}</td>
                  <td style={{ padding: "11px 16px", color: "var(--fg-2)" }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                      <Icon name="map-pin" size={13} color="var(--fg-4)" />
                      {p.location}
                    </span>
                  </td>
                  <td style={{ padding: "11px 16px", color: "var(--fg-2)" }}>{p.type}</td>
                  <td style={{ padding: "11px 16px" }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <span
                        style={{
                          width: 7,
                          height: 7,
                          borderRadius: 999,
                          background: CRED_COLOR[p.cred],
                          flexShrink: 0,
                        }}
                      />
                      <span style={{ color: "var(--fg-2)" }}>{CRED_LABEL[p.cred]}</span>
                    </span>
                  </td>
                  <td
                    className="fs-tnum"
                    style={{
                      padding: "11px 16px",
                      textAlign: "right",
                      fontWeight: 700,
                      color: fairnessColor(p.fairness),
                    }}
                  >
                    {p.fairness}%
                  </td>
                  <td style={{ padding: "11px 16px" }}>
                    <Badge tone={STATUS_TONE[p.status]} dot>
                      {p.status}
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
                  {selected.role} · {selected.team}
                </div>
              </div>
              <Badge tone={STATUS_TONE[selected.status]} dot>
                {selected.status}
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
                  <div style={{ fontSize: 13, fontWeight: 700, color: "var(--fg-1)" }}>Contact &amp; role</div>
                  {(
                    [
                      ["phone", "Phone", selected.phone],
                      ["map-pin", "Location", selected.location],
                      ["briefcase", "Employment", selected.type],
                      ["users", "Team", selected.team],
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
                    <Badge tone={selected.cred} dot>
                      {CRED_LABEL[selected.cred]}
                    </Badge>
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    <Badge tone="success" icon="check">
                      RSA
                    </Badge>
                    <Badge
                      tone={selected.cred === "danger" ? "danger" : "success"}
                      icon={selected.cred === "danger" ? "alert-triangle" : "check"}
                    >
                      First Aid
                    </Badge>
                    <Badge
                      tone={selected.cred === "success" ? "success" : "warning"}
                      icon={selected.cred === "success" ? "check" : "clock"}
                    >
                      RSG
                    </Badge>
                    <Badge tone="success" icon="check">
                      Venue Induction
                    </Badge>
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
                  Fairness score
                </div>
                <Ring
                  value={selected.fairness}
                  size={104}
                  color={fairnessColor(selected.fairness)}
                  label={`${selected.fairness}`}
                  sub="fairness"
                />
                <div style={{ width: "100%" }}>
                  <Bar value={selected.fairness} color={fairnessColor(selected.fairness)} />
                </div>
                <div style={{ fontSize: 11.5, color: "var(--fg-4)", textAlign: "center" }}>
                  Distribution of shifts, overtime and preferred hours.
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
      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add Person"
        size="md"
        footer={
          <>
            <Button variant="sec" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button icon="user-plus" onClick={handleAdd}>
              Add Person
            </Button>
          </>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Field label="Full name">
            <TextField value={fName} onChange={setFName} placeholder="e.g. Jordan Lee" icon="user" />
          </Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <Field label="Role">
              <Select
                value={fRole}
                onChange={setFRole}
                placeholder="Select a role"
                options={ROLE_OPTIONS.map((r) => ({ label: r, value: r }))}
              />
            </Field>
            <Field label="Employment type">
              <Select
                value={fType}
                onChange={setFType}
                placeholder="Select a type"
                options={TYPE_OPTIONS.map((t) => ({ label: t, value: t }))}
              />
            </Field>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <Field label="Team" hint="Optional">
              <TextField value={fTeam} onChange={setFTeam} placeholder="e.g. Bar Team" />
            </Field>
            <Field label="Location" hint="Optional">
              <TextField value={fLocation} onChange={setFLocation} placeholder="e.g. Brightwater Hotel" />
            </Field>
          </div>
        </div>
      </Modal>
    </div>
  );
}
