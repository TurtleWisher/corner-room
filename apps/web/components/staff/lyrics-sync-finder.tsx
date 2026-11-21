"use client";

/*
 * Staff lyrics sync (owner, 2026-11-21, D-LYRICS-04): type part of a song's title or its act's
 * name and open it to fix the words and time them. Arrow keys move through the list and Enter
 * opens the song, so a sync is one search and one key away. A pasted song page address or id
 * still opens that song directly.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { ArrowRight, Search } from "lucide-react";

import { Card, ErrorState } from "@/components/staff/kit";
import { useWorkspace } from "@/components/workspace-provider";
import { searchLyricSongs, type LyricSong } from "@/features/studio/api";
import { ApiError } from "@/lib/api/client";
import { friendlyError } from "@/lib/error-copy";
import { songContext, songIdIn, songMark } from "@/lib/staff-lyrics-view";

/** Wait this long after the last key before asking the server. */
const SEARCH_PAUSE_MS = 220;

const TONE: Record<string, string> = {
  ok: "st-mark st-mark-ok",
  todo: "st-mark st-mark-todo",
  wait: "st-mark st-mark-wait",
  none: "st-mark",
};

export function LyricsSyncFinder() {
  const router = useRouter();
  const { currentOrg } = useWorkspace();
  const workspace = currentOrg?.id ?? null;
  const listId = useId();
  const [q, setQ] = useState("");
  const [songs, setSongs] = useState<LyricSong[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);
  const [active, setActive] = useState(0);
  const round = useRef(0);
  const pastedId = songIdIn(q);

  useEffect(() => {
    if (pastedId) return;
    setHidden(false);
    const mine = ++round.current;
    const timer = window.setTimeout(() => {
      searchLyricSongs(q)
        .then((rows) => {
          if (mine !== round.current) return;
          setSongs(rows);
          setActive(0);
          setError(null);
        })
        .catch((err) => {
          if (mine !== round.current) return;
          // Without the right to approve music the finder simply isn't shown.
          if (err instanceof ApiError && (err.status === 404 || err.status === 403)) setHidden(true);
          else setError(friendlyError(err, "Songs couldn't be searched."));
        });
    }, q ? SEARCH_PAUSE_MS : 0);
    return () => window.clearTimeout(timer);
  }, [q, pastedId, workspace]);

  if (hidden) return null;
  const rows = pastedId ? [] : (songs ?? []);
  const open = (id: string) => router.push(`/staff/catalog/lyrics-timing/${id}`);

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">Sync lyrics</h2>
        <p className="text-xs text-fg-muted">
          <kbd className="st-kbd">↑</kbd> <kbd className="st-kbd">↓</kbd> to move, <kbd className="st-kbd">Enter</kbd> to open
        </p>
      </div>
      <div className="st-search mt-3">
        <Search aria-hidden="true" className="st-search-icon" />
        <input
          type="search"
          role="combobox"
          aria-expanded={rows.length > 0}
          aria-controls={listId}
          aria-activedescendant={rows[active] ? `${listId}-${active}` : undefined}
          aria-label="Find a song by title or artist, or paste its address"
          placeholder="Find a song by title or artist, or paste its address"
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
              if (pastedId) open(pastedId);
              else if (rows[active]) open(rows[active].track_id);
            }
          }}
        />
      </div>
      {error ? <ErrorState message={error} /> : null}
      {pastedId ? (
        <Link href={`/staff/catalog/lyrics-timing/${pastedId}`} className="st-row mt-2" data-active="true">
          <span className="min-w-0 flex-1 truncate font-semibold">Open the pasted song</span>
          <ArrowRight aria-hidden="true" className="size-4" />
        </Link>
      ) : songs === null ? null : rows.length === 0 ? (
        <p className="mt-3 text-sm text-fg-muted">{q ? "No released song matches." : "No released songs yet."}</p>
      ) : (
        <ul id={listId} role="listbox" aria-label="Songs" className="st-rows mt-2">
          {rows.map((song, i) => {
            const mark = songMark(song);
            const context = songContext(song);
            return (
              <li key={song.track_id} id={`${listId}-${i}`} role="option" aria-selected={i === active}>
                <Link
                  href={`/staff/catalog/lyrics-timing/${song.track_id}`}
                  className="st-row"
                  data-active={i === active ? "true" : undefined}
                  onMouseEnter={() => setActive(i)}
                  tabIndex={-1}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{song.title}</span>
                    {context ? <span className="block truncate text-xs text-fg-muted">{context}</span> : null}
                  </span>
                  <span className={TONE[mark.tone]}>{mark.label}</span>
                  <ArrowRight aria-hidden="true" className="st-row-go size-4" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
