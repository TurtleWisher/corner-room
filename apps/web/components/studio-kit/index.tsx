"use client";

/*
 * Studio kit (owner, 2026-11-09, D-MAILBOX-01): the few pieces every artist tool shares, so each
 * list reads and behaves the same. A search field (press / to jump in, Esc to clear), filter chips
 * with counts, a floating bar for what's chosen, a status mark that never relies on colour alone,
 * and a checkbox that feels like a control. Styles in app/styles/modules/studio-kit.css.
 */

import { useEffect, useRef, type ReactNode } from "react";
import { Search, X } from "lucide-react";

import { isSearchShortcut } from "@/lib/search-view";
import type { StatusTone } from "@/lib/format/status";

export function SearchField({
  value,
  onChange,
  label,
  placeholder,
  shortcut = false,
  className,
}: {
  value: string;
  onChange: (next: string) => void;
  /** Read out to screen readers; the placeholder says it to everyone else. */
  label: string;
  placeholder?: string;
  /** Press / anywhere on the page (not while typing) to jump into this field. One per page. */
  shortcut?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!shortcut) return;
    const onKey = (e: KeyboardEvent) => {
      if (isSearchShortcut(e.key, e.target as HTMLElement | null)) {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shortcut]);
  return (
    <div className={`sk-search ${className ?? ""}`} role="search">
      <Search aria-hidden="true" className="sk-search-icon" />
      <input
        ref={ref}
        type="search"
        className="sk-search-input"
        aria-label={label}
        placeholder={placeholder ?? label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && value) {
            e.preventDefault();
            onChange("");
          }
        }}
        autoComplete="off"
        spellCheck={false}
      />
      <span className="sk-search-end">
        {value ? (
          <button type="button" className="sk-clear cr-focus" aria-label="Clear the search" onClick={() => onChange("")}>
            <X aria-hidden="true" className="size-4" />
          </button>
        ) : shortcut ? (
          <kbd className="sk-kbd" aria-hidden="true">
            /
          </kbd>
        ) : null}
      </span>
    </div>
  );
}

export type ChipOption<K extends string> = { key: K; label: string; count?: number | null; dot?: StatusTone };

export function FilterChips<K extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: ChipOption<K>[];
  value: K;
  onChange: (next: K) => void;
  label: string;
}) {
  return (
    <div className="sk-chips" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.key} type="button" className="sk-chip cr-cut cr-focus" aria-pressed={value === o.key} onClick={() => onChange(o.key)}>
          {o.dot ? <span className="sk-status" data-tone={o.dot}><span className="sk-dot" aria-hidden="true" /></span> : null}
          {o.label}
          {o.count != null ? <span className="sk-count">{o.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

/** A dot and a word: the word carries the meaning, the dot the tone. */
export function StatusMark({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  return (
    <span className="sk-status" data-tone={tone}>
      <span className="sk-dot" aria-hidden="true" />
      {children}
    </span>
  );
}

/** Floats at the bottom of the page while something is chosen. */
export function SelectionBar({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="sk-bar cr-cut px-4 py-3" role="region" aria-label={label}>
      {children}
    </div>
  );
}

export function Check({
  checked,
  indeterminate = false,
  onChange,
  label,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate && !checked;
  }, [indeterminate, checked]);
  return <input ref={ref} type="checkbox" className="sk-check" aria-label={label} checked={checked} onChange={(e) => onChange(e.target.checked)} />;
}

/** A small "nothing matches" line with a way back. */
export function NoMatch({ query, onClear }: { query: string; onClear: () => void }) {
  return (
    <p className="py-6 text-center text-sm text-fg-muted">
      Nothing matches &ldquo;{query}&rdquo;.{" "}
      <button type="button" className="cr-focus font-semibold text-link underline" onClick={onClear}>
        Clear the search
      </button>
    </p>
  );
}
