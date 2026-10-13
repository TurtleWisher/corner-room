"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

import { Badge } from "./status-chip";
import type { StatusTone } from "@/lib/format/status";

export interface ToastInput {
  title: string;
  body?: string;
  tone?: Extract<StatusTone, "neutral" | "positive" | "warning" | "negative" | "info">;
}

interface ToastItem extends ToastInput {
  id: number;
}

const ToastContext = React.createContext<((t: ToastInput) => void) | null>(null);

const TONE_LABEL = { neutral: "Note", positive: "Done", warning: "Check", negative: "Problem", info: "Info" } as const;

/** Polite live region for confirmations. Errors that block a task belong inline, not in a toast. */
export function ToastProvider({ children, duration = 6000 }: { children: React.ReactNode; duration?: number }) {
  const [items, setItems] = React.useState<ToastItem[]>([]);
  const seq = React.useRef(0);

  const dismiss = React.useCallback((id: number) => setItems((all) => all.filter((t) => t.id !== id)), []);
  const push = React.useCallback(
    (t: ToastInput) => {
      const id = ++seq.current;
      setItems((all) => [...all.slice(-2), { ...t, id }]);
      window.setTimeout(() => dismiss(id), duration);
    },
    [dismiss, duration],
  );

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex flex-col items-end gap-2 sm:left-auto sm:w-96"
      >
        {items.map((t) => {
          const tone = t.tone ?? "neutral";
          return (
            <div
              key={t.id}
              className={cn(
                "cr-cut pointer-events-auto w-full p-4 text-fg shadow-[0_12px_40px_rgb(0_0_0/0.45)]",
                "cr-glass-card [--cut-border:var(--cr-line-strong)]",
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Badge tone={tone}>{TONE_LABEL[tone]}</Badge>
                  <p className="mt-2 font-ui text-sm font-semibold">{t.title}</p>
                  {t.body ? <p className="mt-0.5 text-sm text-fg-muted">{t.body}</p> : null}
                </div>
                <button
                  type="button"
                  onClick={() => dismiss(t.id)}
                  className="cr-focus -mr-1 -mt-1 p-1 text-xs font-semibold text-fg-muted hover:text-fg"
                >
                  Dismiss
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const push = React.useContext(ToastContext);
  if (!push) throw new Error("useToast must be used inside <ToastProvider>");
  return push;
}
