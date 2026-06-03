"use client";

import { icons } from "lucide-react";
import type { CSSProperties } from "react";

/* ============================================================
   Icon — kebab-case name wrapper around lucide-react.
   The reference UI kit passes Lucide icon names as strings
   (e.g. "badge-check"); this maps them to the PascalCase
   component in lucide-react's `icons` record so screens can
   keep using string names verbatim. Unknown names fall back
   to `circle` rather than crashing the render.
   ============================================================ */

type IconName = keyof typeof icons;

function toPascalCase(name: string): string {
  return name
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

export interface IconProps {
  name: string;
  size?: number;
  stroke?: number;
  color?: string;
  style?: CSSProperties;
  className?: string;
}

export function Icon({
  name,
  size = 18,
  stroke = 1.9,
  color,
  style,
  className,
}: IconProps) {
  const key = toPascalCase(name) as IconName;
  const LucideIcon = icons[key] ?? icons.Circle;
  return (
    <span
      className={className}
      style={{ display: "inline-flex", alignItems: "center", color, ...style }}
    >
      <LucideIcon size={size} strokeWidth={stroke} />
    </span>
  );
}
