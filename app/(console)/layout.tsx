"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/chrome/sidebar";
import { Topbar } from "@/components/chrome/topbar";
import { DATE_LABELS } from "@/components/chrome/nav";

/* ============================================================
   Console shell — fixed navy sidebar + white topbar + scrollable
   card-grid workspace. Resets scroll to top on route change.
   ============================================================ */

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const scrollRef = useRef<HTMLElement>(null);

  // first path segment, e.g. "/attendance" -> "attendance"
  const segment = pathname.split("/").filter(Boolean)[0] ?? "overview";
  const dateLabel = DATE_LABELS[segment];

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [pathname]);

  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden", background: "var(--bg)" }}>
      <Sidebar />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <Topbar dateLabel={dateLabel} />
        <main ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: "24px 28px" }}>
          {children}
        </main>
      </div>
    </div>
  );
}
