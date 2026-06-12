"use client";

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Icon } from "./icon";
import { STATUS, type Tone } from "@/lib/status";

/* ============================================================
   Toast — bottom-right stack of white cards with a status
   dot/icon by tone. Auto-dismiss after ~3500ms; manually
   dismissible. useToast() returns (msg, opts?) => void.
   ============================================================ */

export interface ToastOptions {
  tone?: Tone;
  icon?: string;
}

interface ToastItem {
  id: number;
  msg: string;
  tone: Tone;
  icon?: string;
}

type PushToast = (msg: string, opts?: ToastOptions) => void;

const ToastContext = createContext<PushToast | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const counter = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const push = useCallback<PushToast>(
    (msg, opts) => {
      const id = ++counter.current;
      const item: ToastItem = { id, msg, tone: opts?.tone ?? "teal", icon: opts?.icon };
      setToasts((list) => [...list, item]);
      setTimeout(() => dismiss(id), 3500);
    },
    [dismiss]
  );

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div
        style={{
          position: "fixed",
          bottom: 20,
          right: 20,
          display: "flex",
          flexDirection: "column",
          gap: 10,
          zIndex: 2000,
          pointerEvents: "none",
        }}
      >
        {toasts.map((t) => {
          const [, fg, dc] = STATUS[t.tone] ?? STATUS.neutral;
          return (
            <div
              key={t.id}
              role="status"
              style={{
                pointerEvents: "auto",
                display: "flex",
                alignItems: "center",
                gap: 10,
                minWidth: 260,
                maxWidth: 380,
                background: "#fff",
                border: "1px solid var(--border)",
                borderRadius: 12,
                boxShadow: "var(--shadow-lg)",
                padding: "11px 13px",
              }}
            >
              {t.icon ? (
                <Icon name={t.icon} size={17} color={fg} />
              ) : (
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 999,
                    background: dc,
                    flexShrink: 0,
                  }}
                />
              )}
              <span style={{ flex: 1, fontSize: 13.5, fontWeight: 500, color: "var(--fg-1)" }}>
                {t.msg}
              </span>
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                aria-label="Dismiss"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  border: 0,
                  background: "transparent",
                  cursor: "pointer",
                  color: "var(--fg-4)",
                  padding: 0,
                }}
              >
                <Icon name="x" size={15} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): PushToast {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}
