"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import { Icon } from "./icon";

/* ============================================================
   Button — primary / secondary / ghost / danger / dark,
   default + sm sizes, optional leading/trailing icon.
   Hover deepens per BRAND_README interaction rules.
   ============================================================ */

export type ButtonVariant = "pri" | "sec" | "ghost" | "danger" | "dark";

export interface ButtonProps {
  variant?: ButtonVariant;
  size?: "sm";
  icon?: string;
  iconRight?: string;
  children?: ReactNode;
  onClick?: () => void;
  style?: CSSProperties;
  type?: "button" | "submit" | "reset";
}

const VARIANTS: Record<ButtonVariant, CSSProperties> = {
  pri: { background: "var(--fs-teal)", color: "#fff", boxShadow: "var(--shadow-xs)" },
  sec: { background: "#fff", color: "var(--fg-1)", borderColor: "var(--border-2)" },
  ghost: { background: "transparent", color: "var(--fs-teal)" },
  danger: { background: "#fff", color: "var(--danger-fg)", borderColor: "#F3C9CB" },
  dark: { background: "var(--ink-900)", color: "#fff" },
};

const HOVER: Record<ButtonVariant, CSSProperties> = {
  pri: { background: "var(--fs-teal-600)" },
  sec: { background: "var(--bg-2)" },
  ghost: { background: "var(--fs-teal-tint)" },
  danger: { background: "var(--danger-bg)" },
  dark: { background: "var(--ink-800)" },
};

export function Button({
  variant = "pri",
  size,
  icon,
  iconRight,
  children,
  onClick,
  style,
  type = "button",
}: ButtonProps) {
  const [hover, setHover] = useState(false);
  const base: CSSProperties = {
    fontFamily: "var(--font-body)",
    fontWeight: 600,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    border: "1px solid transparent",
    transition: ".15s",
    whiteSpace: "nowrap",
    fontSize: size === "sm" ? 13 : 14,
    padding: size === "sm" ? "7px 13px" : "10px 16px",
    borderRadius: size === "sm" ? 8 : 10,
  };
  return (
    <button
      type={type}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ ...base, ...VARIANTS[variant], ...(hover ? HOVER[variant] : {}), ...style }}
    >
      {icon && <Icon name={icon} size={size === "sm" ? 15 : 16} />}
      {children}
      {iconRight && <Icon name={iconRight} size={size === "sm" ? 15 : 16} />}
    </button>
  );
}
