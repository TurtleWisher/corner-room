"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import * as React from "react";
import { ArrowRight, Search } from "lucide-react";

import { SearchThumb } from "@/components/search/search-thumb";
import { fetchSearch, type SearchHitRecord } from "@/lib/api";
import { buildSearchHref, isSearchShortcut, SEARCH_DEBOUNCE_MS, searchSuggestions, type SearchSuggestion } from "@/lib/search-view";

/**
 * Header search (owner, 2026-11-01, D-MOTION-03): a lens that opens into a frosted bar when the
 * pointer rests on it or it gets focus, with the best matches appearing under it as you type.
 * Enter on a match opens it; Enter otherwise opens the full results. "/" focuses it from anywhere.
 * Opening and closing are pure CSS (`app/styles/browse.css`); this component only fetches and steers.
 */
export function HeaderSearch() {
  const router = useRouter();
  const pathname = usePathname();
  const input = React.useRef<HTMLInputElement>(null);
  const [q, setQ] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(-1);
  const [hits, setHits] = React.useState<{ q: string; items: SearchSuggestion<SearchHitRecord>[] } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const term = q.trim();

  // Fresh page, fresh bar.
  React.useEffect(() => {
    setQ("");
    setOpen(false);
    setHits(null);
  }, [pathname]);

  React.useEffect(() => {
    if (!term) {
      setHits(null);
      setBusy(false);
      return;
    }
    let live = true;
    setBusy(true);
    const timer = window.setTimeout(() => {
      fetchSearch({ q: term })
        .then((page) => live && setHits({ q: term, items: searchSuggestions(page.items) }))
        .catch(() => live && setHits({ q: term, items: [] }))
        .finally(() => live && setBusy(false));
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [term]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (!isSearchShortcut(e.key, e.target as HTMLElement | null)) return;
      e.preventDefault();
      input.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  React.useEffect(() => setActive(-1), [hits]);

  const items = hits?.items ?? [];
  const showPanel = open && Boolean(term);
  const go = (href: string) => {
    setOpen(false);
    input.current?.blur();
    router.push(href);
  };

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!items.length) return;
      e.preventDefault();
      setOpen(true);
      setActive((i) => (e.key === "ArrowDown" ? (i + 1) % items.length : i <= 0 ? items.length - 1 : i - 1));
    } else if (e.key === "Escape") {
      if (q) setQ("");
      else input.current?.blur();
      setOpen(false);
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const pick = active >= 0 ? items[active] : undefined;
    if (pick) go(pick.href);
    else if (term) go(buildSearchHref(term, null, null));
    else input.current?.focus();
  }

  return (
    <div className="cr-hsearch-slot">
      <form
        role="search"
        onSubmit={onSubmit}
        className="cr-hsearch"
        data-filled={q ? "" : undefined}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false);
        }}
      >
        <button type="submit" tabIndex={-1} aria-label="Search" className="cr-hsearch-lens" onClick={(e) => !term && (e.preventDefault(), input.current?.focus())}>
          <Search className="size-5" aria-hidden="true" />
        </button>
        <label htmlFor="header-search" className="sr-only">
          Search Corner Room
        </label>
        <input
          ref={input}
          id="header-search"
          type="search"
          role="combobox"
          aria-expanded={showPanel}
          aria-controls="header-search-list"
          aria-autocomplete="list"
          aria-activedescendant={showPanel && active >= 0 ? `header-search-${active}` : undefined}
          autoComplete="off"
          enterKeyHint="search"
          placeholder="Search events, artists, music"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
        <kbd aria-hidden="true" className="cr-hsearch-key">
          /
        </kbd>
        {showPanel ? (
          <div className="cr-hsearch-panel">
            <ul id="header-search-list" role="listbox" aria-label="Suggestions" className="py-1.5">
              {items.map((s, i) => (
                <li key={`${s.hit.entity_type}-${s.hit.entity_id}`} id={`header-search-${i}`} role="option" aria-selected={i === active}>
                  <Link
                    href={s.href}
                    tabIndex={-1}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => setOpen(false)}
                    onMouseEnter={() => setActive(i)}
                    style={{ "--i": i } as React.CSSProperties}
                    data-active={i === active ? "" : undefined}
                    className="cr-hsearch-hit grid grid-cols-[2.75rem_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2"
                  >
                    <span className="block w-11">
                      <SearchThumb hit={s.hit} size={44} />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-bold text-fg">{s.hit.title}</span>
                      {s.hit.subtitle ? <span className="block truncate text-xs text-fg-muted">{s.hit.subtitle}</span> : null}
                    </span>
                    <span className="cr-eyebrow text-[0.625rem] text-fg-muted">{s.kind}</span>
                  </Link>
                </li>
              ))}
            </ul>
            <p aria-live="polite" className="sr-only">
              {busy ? "Searching" : hits && hits.q === term ? `${items.length} suggestions` : ""}
            </p>
            {!busy && hits && hits.q === term && items.length === 0 ? (
              <p className="px-4 py-3 text-sm text-fg-muted">Nothing found for &ldquo;{term}&rdquo;. Try a shorter word.</p>
            ) : null}
            {busy && items.length === 0 ? <p className="px-4 py-3 text-sm text-fg-muted">Searching&hellip;</p> : null}
            <Link
              href={buildSearchHref(term, null, null)}
              tabIndex={-1}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setOpen(false)}
              className="group flex items-center justify-between border-t border-line px-4 py-3 text-sm font-semibold text-link hover:bg-surface-overlay"
            >
              <span className="truncate">See all results for &ldquo;{term}&rdquo;</span>
              <ArrowRight aria-hidden="true" className="size-4 shrink-0 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>
        ) : null}
      </form>
    </div>
  );
}
