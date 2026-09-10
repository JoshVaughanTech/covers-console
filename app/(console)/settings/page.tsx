"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import {
  Card,
  Tabs,
  Field,
  TextField,
  TextArea,
  Select,
  Switch,
  Button,
  Badge,
  Icon,
  useToast,
  type SelectOption,
} from "@/components/ui";
import { CardHead, PageHead } from "@/components/screen/page-head";
import { NotComputedNote } from "@/components/screen/not-computed";
import { useCompany } from "@/lib/store/shell";

/* ============================================================
   Settings — preference forms, and one thing that had to go.

   A Security section offered Change password, Two-factor
   authentication, and a list of active sessions with a Revoke
   button beside each. None of them did anything. Change password
   validated the two new fields matched and raised "Password
   updated"; the sessions were a literal array and Revoke removed a
   row from it.

   Every other invented thing in this console reported a state.
   These reported an ACT, on the controls where believing it
   matters most — somebody seeing a session they did not recognise
   would click Revoke and be told it was gone.

   Doubly wrong on the password: Covers has no password to change.
   Sign-in is a one-time code, written to a file for operators and
   delivered to the worker's phone, and lib/store/auth.ts holds no
   password column at all. The form was asking for a secret the
   system has never had.

   The sessions half is the one worth building: the store already
   has sessionsOf() and revokeAllFor(), and DELETE
   /api/auth/session already revokes the caller's own. What is
   missing is an endpoint that lists an operator's sessions, which
   is why this says so rather than showing an empty list.

   The rest of the screen is preference forms. They hold local
   state and store nothing, so the Save buttons went too — a
   button whose only effect is a toast saying it worked is the
   same failure in a smaller place.
   ============================================================ */

const SECTIONS = [
  "Profile",
  "Company",
  "Notifications",
  "Scheduling",
  "Integrations",
] as const;
type Section = (typeof SECTIONS)[number];

const TIMEZONES: SelectOption[] = [
  { label: "Australia/Sydney (AEST)", value: "Australia/Sydney" },
  { label: "Australia/Melbourne (AEST)", value: "Australia/Melbourne" },
  { label: "Australia/Brisbane (AEST)", value: "Australia/Brisbane" },
  { label: "Australia/Adelaide (ACST)", value: "Australia/Adelaide" },
  { label: "Australia/Perth (AWST)", value: "Australia/Perth" },
];

const ROLES: SelectOption[] = [
  { label: "Owner", value: "owner" },
  { label: "Administrator", value: "admin" },
  { label: "Scheduling Manager", value: "manager" },
  { label: "Venue Manager", value: "supervisor" },
  { label: "Viewer", value: "viewer" },
];

const INDUSTRIES: SelectOption[] = [
  { label: "Hospitality", value: "hospitality" },
  { label: "Aged & Disability Care", value: "care" },
  { label: "Security Services", value: "security" },
  { label: "Facilities & Maintenance", value: "facilities" },
  { label: "Logistics & Warehousing", value: "logistics" },
];

const SITES: SelectOption[] = [
  { label: "Brightwater Hotel", value: "brightwater" },
  { label: "Brightwater Gaming Room", value: "brightwater-gaming" },
  { label: "Northside Tavern", value: "northside" },
  { label: "Quayside Bar & Kitchen", value: "quayside" },
  { label: "Off-premise catering", value: "off-premise" },
];

const FAIRNESS: SelectOption[] = [
  { label: "Balanced (hours + preferences)", value: "balanced" },
  { label: "Prioritise even hours", value: "hours" },
  { label: "Prioritise worker preferences", value: "preferences" },
  { label: "Prioritise credential coverage", value: "credentials" },
];

const WEEK_START: SelectOption[] = [
  { label: "Monday", value: "monday" },
  { label: "Sunday", value: "sunday" },
  { label: "Saturday", value: "saturday" },
];

/* ---------- notification toggle definitions ---------- */

interface NotiDef {
  key: keyof NotiState;
  title: string;
  sub: string;
  icon: string;
}

interface NotiState {
  emailDigests: boolean;
  credentialAlerts: boolean;
  lateClockIn: boolean;
  rosterPublished: boolean;
  fairnessReport: boolean;
  mentions: boolean;
}

const NOTI_DEFS: NotiDef[] = [
  { key: "emailDigests", title: "Email digests", sub: "Daily summary of activity across your venues", icon: "mail" },
  { key: "credentialAlerts", title: "Credential alerts", sub: "Expiring licences, tickets and inductions", icon: "shield-alert" },
  { key: "lateClockIn", title: "Late clock-in alerts", sub: "Notify when a worker is more than 10m late", icon: "clock" },
  { key: "rosterPublished", title: "Roster published", sub: "When a roster goes live to your workforce", icon: "calendar-check" },
  { key: "fairnessReport", title: "Weekly fairness report", sub: "Distribution and balance across the team", icon: "scale" },
  { key: "mentions", title: "Mentions", sub: "When you are @mentioned in a job room", icon: "at-sign" },
];

/* ---------- integration definitions ---------- */

interface IntegrationDef {
  key: string;
  name: string;
  desc: string;
  icon?: string;
  img?: string;
}

const INTEGRATIONS: IntegrationDef[] = [
  { key: "idara", name: "Idara Verify", desc: "Real-time credential & right-to-work verification", img: "/assets/idara-icon-t.png" },
  { key: "payroll", name: "Payroll", desc: "Export approved timesheets to your payroll system", icon: "dollar-sign" },
  { key: "calendar", name: "Calendar", desc: "Sync rosters to Google & Outlook calendars", icon: "calendar" },
  { key: "sso", name: "Single Sign-On", desc: "SAML / OIDC sign-in for your organisation", icon: "key-round" },
];

/* ---------- active sessions ---------- */

/* ---------- shared row helpers ---------- */

const grid2: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: 16,
};

function ToggleRow({
  icon,
  title,
  sub,
  checked,
  onChange,
}: {
  icon: string;
  title: string;
  sub: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "13px 0",
        borderBottom: "1px solid var(--border)",
      }}
    >
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 36,
          height: 36,
          flexShrink: 0,
          borderRadius: 10,
          background: "var(--fs-teal-tint)",
          color: "var(--fs-teal-700)",
        }}
      >
        <Icon name={icon} size={18} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--fg-1)" }}>{title}</div>
        <div style={{ fontSize: 12.5, color: "var(--fg-3)", marginTop: 2 }}>{sub}</div>
      </div>
      <Switch checked={checked} onChange={onChange} />
    </div>
  );
}

export default function SettingsPage() {
  const toast = useToast();
  const { company, setCompany } = useCompany();
  const [section, setSection] = useState<Section>("Profile");

  /* ---- Profile ---- */
  const [profile, setProfile] = useState({
    name: "Joshua Vaughan",
    email: "joshvaughantech@gmail.com",
    role: "admin",
    phone: "0412 345 678",
    timezone: "Australia/Melbourne",
  });

  /* ---- Company ---- */
  const [companyForm, setCompanyForm] = useState({
    abn: "53 004 085 616",
    industry: "hospitality",
    address: "Level 4, 120 Collins Street\nMelbourne VIC 3000\nAustralia",
    defaultSite: "brightwater",
  });

  /* ---- Notifications ---- */
  const [noti, setNoti] = useState<NotiState>({
    emailDigests: true,
    credentialAlerts: true,
    lateClockIn: true,
    rosterPublished: true,
    fairnessReport: false,
    mentions: true,
  });

  /* ---- Scheduling ---- */
  const [sched, setSched] = useState({
    fairness: "balanced",
    maxWeeklyHours: "38",
    overtimeThreshold: "40",
    autoPublish: false,
    weekStart: "monday",
  });

  /* ---- Integrations ---- */
  const [connected, setConnected] = useState<Record<string, boolean>>({
    idara: true,
    payroll: false,
    calendar: false,
    sso: false,
  });
  const toggleIntegration = (key: string, name: string) => {
    setConnected((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      toast(next[key] ? `${name} connected` : `${name} disconnected`, {
        tone: next[key] ? "success" : "neutral",
        icon: next[key] ? "plug-zap" : "unplug",
      });
      return next;
    });
  };


  let body: ReactNode = null;

  if (section === "Profile") {
    body = (
      <Card>
        <CardHead title="Profile" right={<Badge tone="teal" icon="user">Your account</Badge>} />
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={grid2}>
            <Field label="Full name">
              <TextField value={profile.name} onChange={(v) => setProfile({ ...profile, name: v })} placeholder="Full name" />
            </Field>
            <Field label="Email address">
              <TextField value={profile.email} onChange={(v) => setProfile({ ...profile, email: v })} type="email" icon="mail" placeholder="you@company.com" />
            </Field>
          </div>
          <div style={grid2}>
            <Field label="Role">
              <Select value={profile.role} onChange={(v) => setProfile({ ...profile, role: v })} options={ROLES} />
            </Field>
            <Field label="Phone">
              <TextField value={profile.phone} onChange={(v) => setProfile({ ...profile, phone: v })} icon="phone" placeholder="04xx xxx xxx" />
            </Field>
          </div>
          <Field label="Timezone" hint="Used for clock-in times and roster displays.">
            <Select value={profile.timezone} onChange={(v) => setProfile({ ...profile, timezone: v })} options={TIMEZONES} />
          </Field>
        </div>
      </Card>
    );
  } else if (section === "Company") {
    body = (
      <Card>
        <CardHead title="Company" right={<Badge tone="neutral" icon="building-2">Organisation</Badge>} />
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={grid2}>
            <Field label="Company name">
              <TextField value={company} onChange={setCompany} placeholder="Company name" />
            </Field>
            <Field label="ABN">
              <TextField value={companyForm.abn} onChange={(v) => setCompanyForm({ ...companyForm, abn: v })} placeholder="00 000 000 000" />
            </Field>
          </div>
          <div style={grid2}>
            <Field label="Industry">
              <Select value={companyForm.industry} onChange={(v) => setCompanyForm({ ...companyForm, industry: v })} options={INDUSTRIES} />
            </Field>
            <Field label="Default venue">
              <Select value={companyForm.defaultSite} onChange={(v) => setCompanyForm({ ...companyForm, defaultSite: v })} options={SITES} />
            </Field>
          </div>
          <Field label="Registered address">
            <TextArea value={companyForm.address} onChange={(v) => setCompanyForm({ ...companyForm, address: v })} rows={3} placeholder="Street, suburb, state, postcode" />
          </Field>
        </div>
      </Card>
    );
  } else if (section === "Notifications") {
    body = (
      <Card>
        <CardHead title="Notifications" right={<Badge tone="info" icon="bell">Delivery</Badge>} />
        <div>
          {NOTI_DEFS.map((d) => (
            <ToggleRow
              key={d.key}
              icon={d.icon}
              title={d.title}
              sub={d.sub}
              checked={noti[d.key]}
              onChange={(v) => setNoti({ ...noti, [d.key]: v })}
            />
          ))}
        </div>
      </Card>
    );
  } else if (section === "Scheduling") {
    body = (
      <Card>
        <CardHead title="Scheduling" right={<Badge tone="teal" icon="calendar-range">Rostering</Badge>} />
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Field label="Fairness weighting" hint="How the auto-scheduler balances shifts across your team.">
            <Select value={sched.fairness} onChange={(v) => setSched({ ...sched, fairness: v })} options={FAIRNESS} />
          </Field>
          <div style={grid2}>
            <Field label="Max weekly hours" hint="Per worker, before a warning is raised.">
              <TextField value={sched.maxWeeklyHours} onChange={(v) => setSched({ ...sched, maxWeeklyHours: v })} type="number" placeholder="38" />
            </Field>
            <Field label="Overtime threshold (hrs)" hint="Hours after which overtime loading applies.">
              <TextField value={sched.overtimeThreshold} onChange={(v) => setSched({ ...sched, overtimeThreshold: v })} type="number" placeholder="40" />
            </Field>
          </div>
          <Field label="Week starts on">
            <Select value={sched.weekStart} onChange={(v) => setSched({ ...sched, weekStart: v })} options={WEEK_START} />
          </Field>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              padding: "13px 14px",
              borderRadius: 12,
              border: "1px solid var(--border)",
              background: "var(--bg-2)",
            }}
          >
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: "var(--fg-1)" }}>Auto-publish rosters</div>
              <div style={{ fontSize: 12.5, color: "var(--fg-3)", marginTop: 2 }}>
                Publish to the workforce automatically once approved.
              </div>
            </div>
            <Switch checked={sched.autoPublish} onChange={(v) => setSched({ ...sched, autoPublish: v })} />
          </div>
        </div>
      </Card>
    );
  } else if (section === "Integrations") {
    body = (
      <Card>
        <CardHead title="Integrations" right={<Badge tone="neutral" icon="blocks">Connections</Badge>} />

        {/* Payroll is not one row among these. Connecting it is what lets a
            venue employ somebody with a tap, and it comes with an ABN, a
            workers' compensation policy and a set of award classifications
            behind it — so it gets a screen rather than a toggle. */}
        <Link
          href="/settings/employer"
          style={{
            display: "flex", alignItems: "center", gap: 14, padding: "14px 16px",
            borderRadius: 12, border: "1px solid var(--fs-teal)", background: "var(--fs-teal-tint)",
            textDecoration: "none", marginBottom: 12,
          }}
        >
          <span
            style={{
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              width: 42, height: 42, flexShrink: 0, borderRadius: 11,
              background: "#fff", border: "1px solid var(--border)", color: "var(--fs-teal)",
            }}
          >
            <Icon name="briefcase" size={20} />
          </span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: "block", fontSize: 14.5, fontWeight: 600, color: "var(--fg-1)" }}>
              Employment &amp; payroll
            </span>
            <span style={{ display: "block", fontSize: 12.5, color: "var(--fg-3)", marginTop: 3 }}>
              One-tap employment — payroll connection, award classifications, engagements
            </span>
          </span>
          <Icon name="arrow-right" size={18} />
        </Link>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {INTEGRATIONS.map((it) => {
            const isOn = connected[it.key];
            return (
              <div
                key={it.key}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  padding: "14px 16px",
                  borderRadius: 12,
                  border: "1px solid var(--border)",
                  background: "#fff",
                }}
              >
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 42,
                    height: 42,
                    flexShrink: 0,
                    borderRadius: 11,
                    background: "var(--bg-2)",
                    border: "1px solid var(--border)",
                    color: "var(--fg-2)",
                    overflow: "hidden",
                  }}
                >
                  {it.img ? (
                    <img src={it.img} alt="Idara" width={24} height={24} style={{ display: "block" }} />
                  ) : (
                    <Icon name={it.icon ?? "plug"} size={20} />
                  )}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 14.5, fontWeight: 600, color: "var(--fg-1)" }}>{it.name}</span>
                    <Badge tone={isOn ? "success" : "neutral"} dot>
                      {isOn ? "Connected" : "Not connected"}
                    </Badge>
                  </div>
                  <div style={{ fontSize: 12.5, color: "var(--fg-3)", marginTop: 3 }}>{it.desc}</div>
                </div>
                <Button
                  variant={isOn ? "danger" : "sec"}
                  size="sm"
                  icon={isOn ? "unplug" : "plus"}
                  onClick={() => toggleIntegration(it.key, it.name)}
                >
                  {isOn ? "Disconnect" : "Connect"}
                </Button>
              </div>
            );
          })}
        </div>
      </Card>
    );
  }

  return (
    <div>
      <PageHead title="Settings" sub="Profile, company, notifications, scheduling and connections." />
      <NotComputedNote>
        These preferences are held for the session and are not stored yet — reloading returns
        them to their defaults, so there is no Save. Two things that WERE on this screen have
        been removed rather than left: a change-password form, for a system whose sign-in is a
        one-time code and which holds no password at all, and a list of active sessions with a
        Revoke button that removed a row and nothing else. Session revocation is real in
        lib/store/auth.ts and wants an endpoint listing an operator&rsquo;s own sessions before it
        can be shown here.
      </NotComputedNote>
      <div style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>
        <div style={{ flexShrink: 0 }}>
          <Card pad={8} style={{ width: 200 }}>
            <nav style={{ display: "flex", flexDirection: "column", gap: 2 }} aria-label="Settings sections">
              {SECTIONS.map((s) => {
                const active = s === section;
                return (
                  <button
                    key={s}
                    type="button"
                    aria-current={active}
                    onClick={() => setSection(s)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      width: "100%",
                      textAlign: "left",
                      border: 0,
                      cursor: "pointer",
                      font: "inherit",
                      fontSize: 14,
                      fontWeight: 600,
                      padding: "9px 12px",
                      borderRadius: 9,
                      transition: ".15s",
                      background: active ? "var(--fs-teal-tint)" : "transparent",
                      color: active ? "var(--fs-teal-700)" : "var(--fg-2)",
                    }}
                  >
                    <Icon name={SECTION_ICONS[s]} size={16} />
                    {s}
                  </button>
                );
              })}
            </nav>
          </Card>
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          {/* compact section switcher for narrow viewports */}
          <div style={{ marginBottom: 16 }}>
            <Tabs tabs={[...SECTIONS]} value={section} onChange={(v) => setSection(v as Section)} />
          </div>
          {body}
        </div>
      </div>
    </div>
  );
}

const SECTION_ICONS: Record<Section, string> = {
  Profile: "user",
  Company: "building-2",
  Notifications: "bell",
  Scheduling: "calendar-range",
  Integrations: "blocks",
};
