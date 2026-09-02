/* ============================================================
   Covers — status tone map
   Each tone resolves to [background, foreground, dot] color vars.
   Status is always a small dot/icon + tinted pill — never a large
   fill (see BRAND_README). Destructure as: const [bg, fg, dc] = STATUS[tone]
   ============================================================ */

export type Tone =
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "teal"
  | "neutral";

export const STATUS: Record<Tone, readonly [string, string, string]> = {
  success: ["var(--success-bg)", "var(--success-fg)", "var(--success)"],
  warning: ["var(--warning-bg)", "var(--warning-fg)", "var(--warning)"],
  danger: ["var(--danger-bg)", "var(--danger-fg)", "var(--danger)"],
  info: ["var(--info-bg)", "var(--info-fg)", "var(--info)"],
  teal: ["var(--fs-teal-tint)", "var(--fs-teal-700)", "var(--fs-teal)"],
  neutral: ["var(--bg-2)", "var(--fg-3)", "var(--fg-4)"],
};
