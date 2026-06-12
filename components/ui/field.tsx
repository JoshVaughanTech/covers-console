"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import { Icon } from "./icon";

/* ============================================================
   Form fields — Field (label/hint wrapper), TextField, TextArea,
   Select. All controlled; onChange emits the value, not the event.
   White surface, var(--border-2) hairline, teal focus ring.
   ============================================================ */

export interface FieldProps {
  label?: ReactNode;
  hint?: ReactNode;
  children?: ReactNode;
}

export function Field({ label, hint, children }: FieldProps) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {label && (
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--fg-2)" }}>{label}</span>
      )}
      {children}
      {hint && <span style={{ fontSize: 12, color: "var(--fg-4)" }}>{hint}</span>}
    </label>
  );
}

const CONTROL_BASE: CSSProperties = {
  width: "100%",
  background: "#fff",
  border: "1px solid var(--border-2)",
  borderRadius: 10,
  padding: "10px 12px",
  font: "inherit",
  fontSize: 14,
  color: "var(--fg-1)",
  outline: "none",
  transition: ".15s",
};

const FOCUS_STYLE: CSSProperties = {
  boxShadow: "var(--ring-focus)",
  borderColor: "var(--fs-teal)",
};

export interface TextFieldProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  icon?: string;
}

export function TextField({ value, onChange, placeholder, type = "text", icon }: TextFieldProps) {
  const [focus, setFocus] = useState(false);
  const input = (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      type={type}
      onFocus={() => setFocus(true)}
      onBlur={() => setFocus(false)}
      style={{
        ...CONTROL_BASE,
        ...(icon ? { paddingLeft: 36 } : {}),
        ...(focus ? FOCUS_STYLE : {}),
      }}
    />
  );
  if (!icon) return input;
  return (
    <div style={{ position: "relative", width: "100%" }}>
      <span
        style={{
          position: "absolute",
          left: 12,
          top: "50%",
          transform: "translateY(-50%)",
          color: "var(--fg-4)",
          pointerEvents: "none",
        }}
      >
        <Icon name={icon} size={16} />
      </span>
      {input}
    </div>
  );
}

export interface TextAreaProps {
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  placeholder?: string;
}

export function TextArea({ value, onChange, rows = 4, placeholder }: TextAreaProps) {
  const [focus, setFocus] = useState(false);
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={rows}
      placeholder={placeholder}
      onFocus={() => setFocus(true)}
      onBlur={() => setFocus(false)}
      style={{ ...CONTROL_BASE, resize: "vertical", ...(focus ? FOCUS_STYLE : {}) }}
    />
  );
}

export interface SelectOption {
  label: string;
  value: string;
}

export interface SelectProps {
  value: string;
  onChange: (v: string) => void;
  options: SelectOption[];
  placeholder?: string;
}

export function Select({ value, onChange, options, placeholder }: SelectProps) {
  const [focus, setFocus] = useState(false);
  return (
    <div style={{ position: "relative", width: "100%" }}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        style={{
          ...CONTROL_BASE,
          appearance: "none",
          WebkitAppearance: "none",
          MozAppearance: "none",
          paddingRight: 34,
          cursor: "pointer",
          color: value ? "var(--fg-1)" : "var(--fg-4)",
          ...(focus ? FOCUS_STYLE : {}),
        }}
      >
        {placeholder && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <span
        style={{
          position: "absolute",
          right: 11,
          top: "50%",
          transform: "translateY(-50%)",
          color: "var(--fg-4)",
          pointerEvents: "none",
        }}
      >
        <Icon name="chevron-down" size={16} />
      </span>
    </div>
  );
}
