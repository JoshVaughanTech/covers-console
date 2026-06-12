"use client";

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Modal } from "./modal";
import { Button, type ButtonVariant } from "./button";
import type { Tone } from "@/lib/status";

/* ============================================================
   Confirm — provider renders a Modal with title/body and
   Cancel + confirm buttons; useConfirm() returns a function
   resolving a Promise<boolean>.
   ============================================================ */

export interface ConfirmOptions {
  title: ReactNode;
  body?: ReactNode;
  confirmLabel?: string;
  tone?: Tone;
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

const TONE_VARIANT: Partial<Record<Tone, ButtonVariant>> = {
  danger: "danger",
  teal: "pri",
};

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((v: boolean) => void) | null>(null);

  const settle = useCallback((value: boolean) => {
    setOpen(false);
    resolver.current?.(value);
    resolver.current = null;
  }, []);

  const confirm = useCallback<ConfirmFn>((nextOpts) => {
    setOpts(nextOpts);
    setOpen(true);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const variant: ButtonVariant = (opts?.tone && TONE_VARIANT[opts.tone]) || "pri";

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal
        open={open}
        onClose={() => settle(false)}
        size="sm"
        title={opts?.title}
        footer={
          <>
            <Button variant="sec" size="sm" onClick={() => settle(false)}>
              Cancel
            </Button>
            <Button variant={variant} size="sm" onClick={() => settle(true)}>
              {opts?.confirmLabel ?? "Confirm"}
            </Button>
          </>
        }
      >
        {opts?.body && (
          <div style={{ fontSize: 14, lineHeight: 1.55, color: "var(--fg-2)" }}>{opts.body}</div>
        )}
      </Modal>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used within a ConfirmProvider");
  return ctx;
}
