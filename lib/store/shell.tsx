"use client";

/* ============================================================
   Covers — app-shell context
   Holds the active company + the notifications feed. Company and
   notification read-state persist to localStorage (SSR-guarded,
   hydrated inside useEffect to avoid hydration mismatch).
   Also exposes useGlobalSearch() over the static search index.
   ============================================================ */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Tone } from "@/lib/status";
import { SEARCH_INDEX } from "@/lib/data/search";

/* ---------- types ---------- */

export interface Notification {
  id: string;
  icon: string;
  tone: Tone;
  title: string;
  meta: string;
  time: string;
  read: boolean;
}

export type SearchResultType = "person" | "job" | "site";

export interface SearchResult {
  id: string;
  type: SearchResultType;
  title: string;
  sub: string;
  href: string;
}

interface ShellState {
  company: string;
  setCompany: (c: string) => void;
  companies: string[];
  notifications: Notification[];
  markAllRead: () => void;
  addNotification: (n: Notification) => void;
}

/* ---------- constants ---------- */

const COMPANIES = [
  "Brightwater Hospitality",
  "BrightHouse Venues",
  "Bright Table Group",
  "Brightside Events & Catering",
];
const DEFAULT_COMPANY = "Brightwater Hospitality";

const COMPANY_KEY = "covers.company";
const READ_KEY = "covers.notifications.read";
const MAX_RESULTS = 8;

const SEED_NOTIFICATIONS: Notification[] = [
  {
    id: "n-credential-alert",
    icon: "shield-alert",
    tone: "danger",
    title: "Credential alert: 2 workers require action",
    meta: "RSA · expiring within 7 days",
    time: "8m ago",
    read: false,
  },
  {
    id: "n-clock-in-james",
    icon: "log-in",
    tone: "success",
    title: "James Carter clocked in at 7:02am",
    meta: "Commercial Build – Level 3",
    time: "21m ago",
    read: false,
  },
  {
    id: "n-job-room-created",
    icon: "message-square-plus",
    tone: "info",
    title: "New function room “Spring Carnival Marquee” created",
    meta: "by Sarah Lee",
    time: "1h ago",
    read: false,
  },
  {
    id: "n-fairness-report",
    icon: "file-check-2",
    tone: "teal",
    title: "Weekly fairness report is ready to view",
    meta: "Roster fairness · 88%",
    time: "2h ago",
    read: true,
  },
  {
    id: "n-roster-published",
    icon: "calendar-check",
    tone: "success",
    title: "Roster published for week of 8 Jun",
    meta: "192 shifts across 5 sites",
    time: "5h ago",
    read: true,
  },
  {
    id: "n-late-arrival",
    icon: "clock",
    tone: "warning",
    title: "Late arrival: Leanne Vidal (+18m)",
    meta: "Brightwater Hotel",
    time: "Yesterday",
    read: true,
  },
];

/* ---------- context ---------- */

const ShellContext = createContext<ShellState | null>(null);

export function ShellProvider({ children }: { children: ReactNode }) {
  const [company, setCompanyState] = useState<string>(DEFAULT_COMPANY);
  const [notifications, setNotifications] =
    useState<Notification[]>(SEED_NOTIFICATIONS);

  /* hydrate persisted state after mount (avoids SSR/client mismatch) */
  useEffect(() => {
    if (typeof window === "undefined") return;

    const savedCompany = window.localStorage.getItem(COMPANY_KEY);
    if (savedCompany && COMPANIES.includes(savedCompany)) {
      setCompanyState(savedCompany);
    }

    const savedRead = window.localStorage.getItem(READ_KEY);
    if (savedRead) {
      try {
        const readIds = JSON.parse(savedRead) as unknown;
        if (Array.isArray(readIds)) {
          const ids = new Set(readIds.map(String));
          setNotifications((prev) =>
            prev.map((n) => (ids.has(n.id) ? { ...n, read: true } : n)),
          );
        }
      } catch {
        /* ignore malformed persisted value */
      }
    }
  }, []);

  const persistRead = useCallback((items: Notification[]) => {
    if (typeof window === "undefined") return;
    const readIds = items.filter((n) => n.read).map((n) => n.id);
    window.localStorage.setItem(READ_KEY, JSON.stringify(readIds));
  }, []);

  const setCompany = useCallback((c: string) => {
    setCompanyState(c);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(COMPANY_KEY, c);
    }
  }, []);

  const markAllRead = useCallback(() => {
    setNotifications((prev) => {
      const next = prev.map((n) => ({ ...n, read: true }));
      persistRead(next);
      return next;
    });
  }, [persistRead]);

  const addNotification = useCallback(
    (n: Notification) => {
      setNotifications((prev) => {
        const next = [n, ...prev];
        persistRead(next);
        return next;
      });
    },
    [persistRead],
  );

  const value = useMemo<ShellState>(
    () => ({
      company,
      setCompany,
      companies: COMPANIES,
      notifications,
      markAllRead,
      addNotification,
    }),
    [company, setCompany, notifications, markAllRead, addNotification],
  );

  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

function useShell(): ShellState {
  const ctx = useContext(ShellContext);
  if (!ctx) {
    throw new Error("useShell must be used within a ShellProvider");
  }
  return ctx;
}

/* ---------- public hooks ---------- */

export function useCompany() {
  const { company, setCompany, companies } = useShell();
  return { company, setCompany, companies };
}

export function useNotifications() {
  const { notifications, markAllRead, addNotification } = useShell();
  const unread = useMemo(
    () => notifications.filter((n) => !n.read).length,
    [notifications],
  );
  return { items: notifications, unread, markAllRead, add: addNotification };
}

export function useGlobalSearch(query: string): SearchResult[] {
  return useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return SEARCH_INDEX.filter((e) => e.terms.includes(q))
      .slice(0, MAX_RESULTS)
      .map(({ id, type, title, sub, href }) => ({
        id,
        type,
        title,
        sub,
        href,
      }));
  }, [query]);
}
