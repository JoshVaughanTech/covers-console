"use client";

import type { ReactNode } from "react";
import NextLink from "next/link";
import { Icon } from "@/components/ui/icon";

/* ============================================================
   Shared screen primitives used across console dashboards.
   - PageHead : screen title + subtitle + right-aligned actions
   - CardHead : in-card title row + right-aligned slot
   - LinkBtn  : teal "View all →" affordance (button or next/link)
   ============================================================ */

export function PageHead({
  title,
  sub,
  right,
}: {
  title: ReactNode;
  sub?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 16, marginBottom: 20 }}>
      <div style={{ flex: 1 }}>
        <h2 style={{ margin: 0, fontSize: 26 }}>{title}</h2>
        {sub && <p style={{ margin: "4px 0 0", fontSize: 14.5 }}>{sub}</p>}
      </div>
      {right}
    </div>
  );
}

export function CardHead({ title, right }: { title: ReactNode; right?: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", marginBottom: 14 }}>
      <h4 style={{ margin: 0, fontSize: 15.5, flex: 1 }}>{title}</h4>
      {right}
    </div>
  );
}

export function LinkBtn({
  children,
  onClick,
  href,
}: {
  children: ReactNode;
  onClick?: () => void;
  href?: string;
}) {
  const inner = (
    <>
      {children} <Icon name="arrow-right" size={14} />
    </>
  );
  const sharedStyle = {
    border: 0,
    background: "transparent",
    color: "var(--fs-teal)",
    fontWeight: 600,
    fontSize: 13,
    cursor: "pointer",
    font: "inherit",
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    textDecoration: "none",
  } as const;

  if (href) {
    return (
      <NextLink href={href} style={sharedStyle}>
        {inner}
      </NextLink>
    );
  }
  return (
    <button onClick={onClick} style={sharedStyle}>
      {inner}
    </button>
  );
}
