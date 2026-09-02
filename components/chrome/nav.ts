/* ============================================================
   Console left-nav model. `idara` flags the verification module.
   ============================================================ */

export interface NavItem {
  id: string;
  label: string;
  icon: string;
  href: string;
  idara?: boolean;
}

export const NAV: NavItem[] = [
  { id: "overview", label: "Overview", icon: "layout-grid", href: "/overview" },
  { id: "schedule", label: "Schedule", icon: "calendar-days", href: "/schedule" },
  { id: "jobs", label: "Functions", icon: "party-popper", href: "/jobs" },
  { id: "attendance", label: "Time & Attendance", icon: "clock", href: "/attendance" },
  { id: "projects", label: "Run Sheets", icon: "clipboard-list", href: "/projects" },
  { id: "people", label: "People", icon: "users", href: "/people" },
  { id: "comms", label: "Communications", icon: "message-square", href: "/comms" },
  { id: "credentials", label: "Credentials", icon: "badge-check", href: "/credentials", idara: true },
  { id: "audit", label: "Audit Log", icon: "scroll-text", href: "/audit", idara: true },
  { id: "reports", label: "Reports", icon: "bar-chart-3", href: "/reports" },
  { id: "settings", label: "Settings", icon: "settings", href: "/settings" },
];

/* Per-screen date label shown in the topbar pill. */
export const DATE_LABELS: Record<string, string> = {
  overview: "May 12 – May 18, 2024",
  schedule: "May 12 – May 18, 2024",
  attendance: "Fri 16 May, 2024",
  credentials: "Thu 16 May, 2024",
  comms: "Fri 16 May, 2024",
  projects: "Thu 16 May, 2024",
};
