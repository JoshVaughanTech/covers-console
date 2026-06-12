"use client";

import { useEffect, type CSSProperties, type ReactNode } from "react";
import { Icon } from "./icon";

/* ============================================================
   Modal — fixed navy-tinted overlay + centered white card.
   Closes on overlay mousedown, Esc, and the X button. Locks
   body scroll while open. Renders null when closed; SSR-safe.
   ============================================================ */

export type ModalSize = "sm" | "md" | "lg";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  size?: ModalSize;
  footer?: ReactNode;
  children?: ReactNode;
}

const MAX_WIDTH: Record<ModalSize, number> = { sm: 420, md: 580, lg: 860 };

export function Modal({ open, onClose, title, size = "md", footer, children }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  const overlay: CSSProperties = {
    position: "fixed",
    inset: 0,
    background: "rgba(10,26,40,.45)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    zIndex: 1000,
  };

  const card: CSSProperties = {
    background: "#fff",
    borderRadius: 16,
    border: "1px solid var(--border)",
    boxShadow: "var(--shadow-lg)",
    width: "100%",
    maxWidth: MAX_WIDTH[size],
    maxHeight: "90vh",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  };

  return (
    <div
      style={overlay}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div role="dialog" aria-modal="true" style={card} onMouseDown={(e) => e.stopPropagation()}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "16px 20px",
            borderBottom: "1px solid var(--border)",
            flexShrink: 0,
          }}
        >
          <div style={{ fontSize: 16, fontWeight: 700, color: "var(--fg-1)", flex: 1 }}>
            {title}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 32,
              height: 32,
              border: 0,
              background: "transparent",
              borderRadius: 8,
              cursor: "pointer",
              color: "var(--fg-3)",
            }}
          >
            <Icon name="x" size={18} />
          </button>
        </div>
        <div style={{ padding: 20, overflowY: "auto", maxHeight: "80vh", flex: 1 }}>{children}</div>
        {footer && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-end",
              gap: 10,
              padding: "14px 20px",
              borderTop: "1px solid var(--border)",
              flexShrink: 0,
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
