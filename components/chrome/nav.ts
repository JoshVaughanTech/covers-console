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
  { id: "jobs", label: "Jobs", icon: "briefcase", href: "/jobs" },
  { id: "attendance", label: "Time & Attendance", icon: "clock", href: "/attendance" },
  { id: "projects", label: "Projects", icon: "folder-kanban", href: "/projects" },
  { id: "people", label: "People", icon: "users", href: "/people" },
  { id: "comms", label: "Communications", icon: "message-square", href: "/comms" },
  { id: "credentials", label: "Credentials", icon: "badge-check", href: "/credentials", idara: true },
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
