"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

export interface TabItem {
  id: string;
  label: React.ReactNode;
  content: React.ReactNode;
  disabled?: boolean;
}

export interface TabsProps {
  items: TabItem[];
  /** Accessible name for the tab list. */
  label: string;
  value?: string;
  defaultValue?: string;
  onValueChange?: (id: string) => void;
  /** Keep every panel in the page (only the chosen one shows), so typing in a form isn't lost on a switch. */
  keepMounted?: boolean;
  /** "sm" for tabs inside a card. */
  size?: "md" | "sm";
  className?: string;
  panelClassName?: string;
}

/** WAI-ARIA tabs: arrow keys, Home and End move focus; automatic activation. */
export function Tabs({ items, label, value, defaultValue, onValueChange, keepMounted = false, size = "md", className, panelClassName }: TabsProps) {
  const [inner, setInner] = React.useState(defaultValue ?? items[0]?.id);
  const active = value ?? inner;
  const base = React.useId().replace(/:/g, "");
  const refs = React.useRef<Record<string, HTMLButtonElement | null>>({});
  const enabled = items.filter((t) => !t.disabled);

  const select = (id: string) => {
    if (value === undefined) setInner(id);
    onValueChange?.(id);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const i = enabled.findIndex((t) => t.id === active);
    let next: TabItem | undefined;
    if (e.key === "ArrowRight") next = enabled[(i + 1) % enabled.length];
    else if (e.key === "ArrowLeft") next = enabled[(i - 1 + enabled.length) % enabled.length];
    else if (e.key === "Home") next = enabled[0];
    else if (e.key === "End") next = enabled[enabled.length - 1];
    if (next) {
      e.preventDefault();
      select(next.id);
      refs.current[next.id]?.focus();
    }
  };

  return (
    <div className={className}>
      {/* On a narrow screen the tabs scroll sideways instead of wrapping or pushing the page wide. */}
      <div
        role="tablist"
        aria-label={label}
        className="flex gap-1 overflow-x-auto shadow-[inset_0_-1px_0_var(--cr-line)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        onKeyDown={onKeyDown}
      >
        {items.map((t) => {
          const selected = t.id === active;
          return (
            <button
              key={t.id}
              ref={(el) => {
                refs.current[t.id] = el;
              }}
              role="tab"
              type="button"
              id={`${base}-tab-${t.id}`}
              aria-selected={selected}
              aria-controls={`${base}-panel-${t.id}`}
              tabIndex={selected ? 0 : -1}
              disabled={t.disabled}
              onClick={() => select(t.id)}
              className={cn(
                "cr-focus relative inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap font-ui font-semibold transition-colors duration-[var(--cr-dur-interaction)]",
                size === "sm" ? "h-9 px-3 text-[0.8125rem]" : "h-11 px-4 text-sm",
                "border-b-2 disabled:opacity-40",
                selected ? "border-highlight text-fg" : "border-transparent text-fg-muted hover:text-fg",
              )}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      {items.map((t) => (
        <div
          key={t.id}
          role="tabpanel"
          id={`${base}-panel-${t.id}`}
          aria-labelledby={`${base}-tab-${t.id}`}
          hidden={t.id !== active}
          tabIndex={0}
          className={cn("cr-focus", size === "sm" ? "pt-4" : "pt-5", panelClassName)}
        >
          {keepMounted || t.id === active ? t.content : null}
        </div>
      ))}
    </div>
  );
}
