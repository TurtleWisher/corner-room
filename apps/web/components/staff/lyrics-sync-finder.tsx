"use client";

/*
 * Staff lyrics sync (owner, 2026-11-21, D-LYRICS-04): type part of a song's title or its act's
 * name and open it to fix the words and time them. Nothing is listed until something is typed
 * (owner, 2026-11-21: "only when I start writing"); the list then unfolds under the field, the
 * typed words lit in each row. Arrow keys move, Enter opens, Escape clears. A pasted song page
 * address or id still opens that song directly.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { ArrowRight, LoaderCircle, Search, X } from "lucide-react";

import { Card } from "@/components/staff/kit";
import { useWorkspace } from "@/components/workspace-provider";
import { searchLyricSongs, type LyricSong } from "@/features/studio/api";
import { ApiError } from "@/lib/api/client";
import { friendlyError } from "@/lib/error-copy";
import { matchParts, searchWords, songContext, songIdIn, songMark } from "@/lib/staff-lyrics-view";

/** Wait this long after the last key before asking the server. */
const SEARCH_PAUSE_MS = 200;
/** Rows past this many arrive together instead of one after another. */
const STAGGER_ROWS = 8;

const TONE: Record<string, string> = {
  ok: "st-mark st-mark-ok",
  todo: "st-mark st-mark-todo",
  wait: "st-mark st-mark-wait",
  none: "st-mark",
};

function Lit({ text, q }: { text: string; q: string }) {
  return (
    <>
      {matchParts(text, q).map((p, i) =>
        p.hit ? (
          <mark key={i} className="st-hit">
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}

export function LyricsSyncFinder() {
  const router = useRouter();
  const { currentOrg } = useWorkspace();
  const workspace = currentOrg?.id ?? null;
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [songs, setSongs] = useState<LyricSong[] | null>(null);
  const [searched, setSearched] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);
  const [active, setActive] = useState(0);
  const round = useRef(0);
  const pastedId = songIdIn(q);
  const typed = searchWords(q).join(" ");

  // Without the right to approve music the finder isn't shown: one quiet check per workspace,
  // whose answer is never listed.
  useEffect(() => {
    let live = true;
    setHidden(false);
    searchLyricSongs("")
      .then(() => undefined)
      .catch((err) => {
        if (live && err instanceof ApiError && (err.status === 404 || err.status === 403)) setHidden(true);
      });
    return () => {
      live = false;
    };
  }, [workspace]);

  useEffect(() => {
    const mine = ++round.current;
    if (pastedId || !typed) {
      // The last list stays inside the fold while it closes, so it folds away instead of vanishing.
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    const timer = window.setTimeout(() => {
      searchLyricSongs(typed)
        .then((rows) => {
          if (mine !== round.current) return;
          setSongs(rows);
          setSearched(typed);
          setActive(0);
          setError(null);
        })
        .catch((err) => {
          if (mine !== round.current) return;
          if (err instanceof ApiError && (err.status === 404 || err.status === 403)) setHidden(true);
          else setError(friendlyError(err, "Songs couldn't be searched."));
        })
        .finally(() => {
          if (mine === round.current) setLoading(false);
        });
    }, SEARCH_PAUSE_MS);
    return () => window.clearTimeout(timer);
  }, [typed, pastedId, workspace]);

  if (hidden) return null;
  const rows = pastedId ? [] : (songs ?? []);
  const open = Boolean(pastedId || error || (typed && songs !== null));
  const go = (id: string) => router.push(`/staff/catalog/lyrics-timing/${id}`);
  const clear = () => {
    setQ("");
    input.current?.focus();
  };

  return (
    <Card className="st-finder-card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">Sync lyrics</h2>
        <p className="text-xs text-fg-muted" aria-hidden="true">
          {open && rows.length ? (
            <>
              <kbd className="st-kbd">↑</kbd> <kbd className="st-kbd">↓</kbd> move · <kbd className="st-kbd">Enter</kbd> open · <kbd className="st-kbd">Esc</kbd> clear
            </>
          ) : (
            "Type a song or an artist to find it"
          )}
        </p>
      </div>
      <div className="st-search mt-3" data-busy={loading ? "true" : undefined}>
        <Search aria-hidden="true" className="st-search-icon" />
        <input
          ref={input}
          type="search"
          role="combobox"
          aria-expanded={open && rows.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && rows[active] ? `${listId}-${active}` : undefined}
          aria-label="Find a song by title or artist, or paste its address"
          placeholder="Find a song by title or artist, or paste its address"
          autoComplete="off"
          spellCheck={false}
          className="st-search-input"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((i) => Math.min(i + 1, Math.max(rows.length - 1, 0)));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              if (pastedId) go(pastedId);
              else if (rows[active]) go(rows[active].track_id);
            } else if (e.key === "Escape" && q) {
              e.preventDefault();
              setQ("");
            }
          }}
        />
        {loading ? <LoaderCircle aria-hidden="true" className="st-search-spin" /> : null}
        {q && !loading ? (
          <button type="button" className="st-search-clear cr-focus" onClick={clear} aria-label="Clear the search">
            <X aria-hidden="true" className="size-3.5" />
          </button>
        ) : null}
      </div>

      {/* The list unfolds once something is typed, and folds away when the field is cleared. */}
      <div className="st-fold" data-open={open ? "true" : undefined} inert={!open}>
        <div className="st-fold-inner">
          {error ? (
            <p role="alert" className="pt-3 text-sm text-danger">
              {error}
            </p>
          ) : pastedId ? (
            <Link href={`/staff/catalog/lyrics-timing/${pastedId}`} className="st-row st-row-in mt-2" data-active="true">
              <span className="min-w-0 flex-1 truncate font-semibold">Open the pasted song</span>
              <ArrowRight aria-hidden="true" className="st-row-go size-4" />
            </Link>
          ) : rows.length === 0 ? (
            <p className="pt-3 text-sm text-fg-muted">
              No released song matches &ldquo;{searched}&rdquo;.
            </p>
          ) : (
            <>
              <p className="pt-3 text-xs text-fg-muted" aria-live="polite">
                {rows.length === 1 ? "1 song" : `${rows.length} songs`}
                {rows.length >= 30 ? ", the newest first. Type more to narrow it down." : ""}
              </p>
              <ul id={listId} role="listbox" aria-label="Songs" className="st-rows mt-1" data-stale={loading ? "true" : undefined}>
                {rows.map((song, i) => {
                  const mark = songMark(song);
                  const context = songContext(song);
                  return (
                    <li
                      key={`${searched}:${song.track_id}`}
                      id={`${listId}-${i}`}
                      role="option"
                      aria-selected={i === active}
                      className="st-row-in"
                      style={{ ["--i" as string]: Math.min(i, STAGGER_ROWS) }}
                    >
                      <Link
                        href={`/staff/catalog/lyrics-timing/${song.track_id}`}
                        className="st-row"
                        data-active={i === active ? "true" : undefined}
                        onMouseEnter={() => setActive(i)}
                        tabIndex={-1}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-semibold">
                            <Lit text={song.title} q={searched} />
                          </span>
                          {context ? (
                            <span className="block truncate text-xs text-fg-muted">
                              <Lit text={context} q={searched} />
                            </span>
                          ) : null}
                        </span>
                        <span className={TONE[mark.tone]}>{mark.label}</span>
                        <ArrowRight aria-hidden="true" className="st-row-go size-4" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      </div>
    </Card>
  );
}
