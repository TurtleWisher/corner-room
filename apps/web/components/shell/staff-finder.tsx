"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { CornerDownLeft, Search } from "lucide-react";

import { NavIcon } from "@/components/shell/nav-icons";
import { JUMP_EVENT } from "@/components/staff/queue-jump";
import { useStaffQueues } from "@/components/staff/staff-queues";
import type { NavSection } from "@/lib/nav-view";
import { badgeText, findPages, findQueues, pageOf, stepIndex } from "@/lib/staff-console-view";

/**
 * The staff page finder (owner, 2026-11-15): Ctrl+K (or the header field) opens a list of every
 * staff page this person can open; type a few letters, arrow to one, Enter goes there. It lists
 * the same pages as the side navigation, so it shows nothing a person may not open. Queues with
 * work waiting come first (owner, 2026-11-21): Ctrl+K, Enter lands on the oldest pile of work.
 */
export function StaffFinder({ sections }: { sections: NavSection[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [at, setAt] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const { queues } = useStaffQueues();
  const hits = useMemo(() => {
    const pages = findPages(sections, query).map((p) => ({ href: p.href, label: p.label, side: p.section, icon: p.href, count: null as number | null }));
    const work = findQueues(queues, query).map((q) => ({ href: q.href, label: q.label, side: "Waiting", icon: pageOf(q.href), count: q.count }));
    return [...work, ...pages];
  }, [sections, queues, query]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setAt(0);
    input.current?.focus();
  }, [open]);

  const go = (href: string) => {
    setOpen(false);
    const [page, id] = href.split("#");
    // A queue on the page already open: glide to it instead of loading the page again.
    if (id && page === pathname) window.dispatchEvent(new CustomEvent(JUMP_EVENT, { detail: id }));
    else router.push(href);
  };

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" className="st-finder-open cr-focus" aria-label="Find a staff page">
        <Search aria-hidden="true" className="size-4" />
        <span className="hidden md:inline">Find a page</span>
        <kbd aria-hidden="true" className="st-kbd hidden md:inline-flex">
          Ctrl K
        </kbd>
      </button>
      {open ? (
        <div className="st-finder-veil" onPointerDown={(e) => e.target === e.currentTarget && setOpen(false)}>
          <div role="dialog" aria-modal="true" aria-label="Find a staff page" data-theme="staff" className="cr-scope st-finder">
            <div className="st-finder-top">
              <Search aria-hidden="true" className="size-4 text-fg-muted" />
              <input
                ref={input}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setAt(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                    e.preventDefault();
                    setAt((i) => stepIndex(i, e.key === "ArrowDown" ? 1 : -1, hits.length));
                  } else if (e.key === "Enter" && hits[at]) {
                    e.preventDefault();
                    go(hits[at].href);
                  }
                }}
                role="combobox"
                aria-expanded="true"
                aria-controls="st-finder-list"
                aria-activedescendant={hits[at] ? `st-hit-${at}` : undefined}
                aria-label="Page or queue name"
                placeholder="Type a page or queue name"
                autoComplete="off"
                className="st-finder-input"
              />
              <kbd aria-hidden="true" className="st-kbd">
                Esc
              </kbd>
            </div>
            <ul id="st-finder-list" role="listbox" aria-label="Staff pages" className="st-finder-list">
              {hits.length === 0 ? (
                <li className="px-4 py-6 text-sm text-fg-muted">No staff page matches &ldquo;{query}&rdquo;.</li>
              ) : (
                hits.map((hit, i) => (
                  <li key={`${hit.side}|${hit.href}|${hit.label}`} id={`st-hit-${i}`} role="option" aria-selected={i === at}>
                    <button type="button" tabIndex={-1} className="st-finder-row" data-on={i === at || undefined} onPointerMove={() => setAt(i)} onClick={() => go(hit.href)}>
                      <NavIcon href={hit.icon} className="size-4 text-fg-muted" />
                      <span className="flex-1 text-left font-semibold text-fg">{hit.label}</span>
                      {hit.count ? <span className="st-badge">{badgeText(hit.count)}</span> : null}
                      <span className="text-xs text-fg-muted">{hit.side}</span>
                      {i === at ? <CornerDownLeft aria-hidden="true" className="size-3.5 text-highlight" /> : <span className="size-3.5" />}
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>
        </div>
      ) : null}
    </>
  );
}
