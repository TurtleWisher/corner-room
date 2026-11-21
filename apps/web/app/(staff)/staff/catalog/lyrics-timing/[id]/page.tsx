"use client";

/*
 * Lyrics sync (owner, 2026-11-01, D-LYRICS-03; words on the same page 2026-11-21, D-LYRICS-04).
 * Staff play a released song and tap once as each sung line starts; the listening room then brings
 * each line in on its own time. The words can be fixed right here (wording, spacing, lines): they
 * are the song's own lyrics, so the song page, the listening room and Studio show the fix once it
 * is saved. A fix with the same number of lines keeps every time; adding or removing a line keeps
 * the times before it. Taps come from the audio's own clock, so they are as exact as the person.
 */

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, CircleAlert, Pause, Play, RotateCcw, Undo2 } from "lucide-react";

import { usePlayer, usePlayerProgress } from "@/components/music/player";
import { Button, Card, ErrorState, LoadingState, Protected } from "@/components/staff/kit";
import { fetchStaffLyrics, reviewLyrics, saveLyricTimings, saveStaffLyrics, type StaffLyrics } from "@/features/studio/api";
import { friendlyError } from "@/lib/error-copy";
import { lyricIndexAt, lyricLines, lyricLrc, lyricStamp, lyricTimes, shiftLines, tapLine } from "@/lib/lyrics-view";
import { carryTimes, saveAction, tidyLyrics } from "@/lib/staff-lyrics-view";

/** How far before a line a retake starts playing, so the tap can be made in time. */
const RETAKE_LEAD_S = 3;
/** One nudge of every time, for taps that came a little late or early. */
const NUDGE_MS = 100;

function typing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
}

function Workbench({ initial }: { initial: StaffLyrics }) {
  const player = usePlayer();
  const { position, duration } = usePlayerProgress();
  const [record, setRecord] = useState(initial);
  const [draft, setDraft] = useState(initial.lyrics ?? "");
  const [times, setTimes] = useState<number[]>(initial.lyrics_timings_ms ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const track = { id: record.track_id, title: record.title };
  const lines = useMemo(() => lyricLines(draft), [draft]);
  const current = player.isCurrent(track.id);
  const playing = current && player.status === "playing";
  const done = lines.length > 0 && times.length === lines.length;
  const seconds = useMemo(() => (done ? lyricTimes(lines.length, times) : null), [done, lines.length, times]);
  const now = current && seconds ? lyricIndexAt(lines.length, position, duration, seconds) : -1;
  const lockedBy = record.lyrics_waiting && !record.waiting_from_me;
  const action = lockedBy
    ? null
    : saveAction({ draft, live: record.lyrics, times, stored: record.lyrics_timings_ms, approvesAtOnce: record.approves_at_once });

  const playFrom = useCallback(
    async (at: number) => {
      if (!player.isCurrent(track.id)) {
        await player.play({ id: track.id, title: track.title });
        if (at > 0) player.seek(at);
        return;
      }
      player.seek(Math.max(0, at));
      if (player.status !== "playing") player.toggle();
    },
    [player, track.id, track.title],
  );

  const tap = useCallback(() => {
    if (!playing || times.length >= lines.length) return;
    setNotice(null);
    setTimes((was) => (was.length >= lines.length ? was : tapLine(was, player.exactPosition() * 1000)));
  }, [playing, times.length, lines.length, player]);

  const undo = useCallback(() => setTimes((was) => was.slice(0, -1)), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typing(e.target) || e.repeat) return;
      if (e.key === " ") {
        // Space is the tap key everywhere on this page outside the words, even with a button focused.
        e.preventDefault();
        tap();
      } else if (e.key === "Backspace") {
        e.preventDefault();
        undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tap, undo]);

  function editWords(next: string) {
    setTimes((was) => carryTimes(lyricLines(draft), lyricLines(next), was));
    setDraft(next);
    setNotice(null);
  }

  function retake(i: number) {
    const from = (times[i] ?? times[times.length - 1] ?? 0) / 1000 - RETAKE_LEAD_S;
    setTimes((was) => was.slice(0, i));
    setNotice(null);
    void playFrom(from);
  }

  function landed(out: StaffLyrics, words: string) {
    setRecord(out);
    if (!out.lyrics_waiting) setDraft(out.lyrics ?? "");
    setNotice(words);
  }

  async function run(work: () => Promise<void>, fallback: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await work();
    } catch (err) {
      setError(friendlyError(err, fallback));
    } finally {
      setBusy(false);
    }
  }

  const save = () =>
    run(async () => {
      if (!action) return;
      if (action.words) {
        const out = await saveStaffLyrics(track.id, tidyLyrics(draft), action.times ? times : null);
        landed(
          out,
          out.lyrics_waiting
            ? "Sent for approval: you run this act, so its words wait like any artist's. Approve them below."
            : action.times
              ? "Saved. The song page, the listening room and Studio show the new words on their times."
              : "Words saved. The song page, the listening room and Studio show them now.",
        );
        return;
      }
      const out = await saveLyricTimings(track.id, times);
      setRecord((r) => ({ ...r, lyrics_timings_ms: out.lyrics_timings_ms }));
      setNotice("Saved. The listening room now brings each line in on its time.");
    }, "The changes couldn't be saved.");

  const removeTimings = () =>
    run(async () => {
      const out = await saveLyricTimings(track.id, null);
      setRecord((r) => ({ ...r, lyrics_timings_ms: out.lyrics_timings_ms }));
      setTimes([]);
      setNotice("Timings removed. The room paces the lines across the song again.");
    }, "The timings couldn't be removed.");

  const approveWaiting = () =>
    run(async () => {
      await reviewLyrics(track.id, "approve");
      const out = await fetchStaffLyrics(track.id);
      const live = lyricLines(out.lyrics);
      const kept = carryTimes(lines, live, times);
      // The taps made while the words waited are kept as soon as the words are live.
      if (live.length > 0 && kept.length === live.length && JSON.stringify(kept) !== JSON.stringify(out.lyrics_timings_ms ?? [])) {
        const timed = await saveLyricTimings(track.id, kept);
        out.lyrics_timings_ms = timed.lyrics_timings_ms;
      }
      setTimes(kept);
      landed(out, "Approved. The song page, the listening room and Studio show the new words.");
    }, "The words couldn't be approved.");

  return (
    <div className="st-sync grid gap-4">
      <Card className="st-sync-deck p-4">
        <div className="flex flex-wrap items-center gap-2">
          {playing ? (
            <Button type="button" variant="outline" onClick={() => player.toggle()}>
              <Pause aria-hidden="true" /> Pause
            </Button>
          ) : (
            <Button type="button" variant="outline" onClick={() => void (current ? player.toggle() : playFrom(0))}>
              <Play aria-hidden="true" /> {current ? "Resume" : "Play"}
            </Button>
          )}
          <Button type="button" variant="ghost" onClick={() => void playFrom(0)} aria-label="Play from the start">
            <RotateCcw aria-hidden="true" />
          </Button>
          <span className="tabular-nums text-sm text-fg-muted" aria-live="off">
            {current ? `${lyricStamp(position * 1000)} / ${lyricStamp(duration * 1000)}` : "Not playing"}
          </span>
          <span className="ml-auto text-xs text-fg-muted">
            <kbd className="st-kbd">Space</kbd> tap · <kbd className="st-kbd">Backspace</kbd> undo
          </span>
        </div>
        {current && player.problem ? (
          <p role="alert" className="mt-3 flex items-center gap-2 text-sm text-danger">
            <CircleAlert aria-hidden="true" className="size-4" /> The song couldn&apos;t play here. Check that this account can play it.
          </p>
        ) : null}
        <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto] md:items-stretch">
          <div className="st-sync-now" aria-live="polite" data-done={done ? "true" : undefined}>
            {lines.length === 0 ? (
              <p className="text-sm text-fg-muted">Type the words below to start.</p>
            ) : done ? (
              <>
                <p className="st-eyebrow">On time now</p>
                <p key={now} className="st-sync-line">{now >= 0 ? lines[now] : "Before the first line"}</p>
              </>
            ) : (
              <>
                <p className="st-eyebrow">
                  Next tap · line {times.length + 1} of {lines.length}
                </p>
                <p key={times.length} className="st-sync-line">{lines[times.length]}</p>
              </>
            )}
            <span className="st-sync-meter" style={{ ["--done" as string]: lines.length ? times.length / lines.length : 0 }} aria-hidden="true" />
          </div>
          <div className="flex gap-2">
            <Button type="button" className="st-tap h-16 min-w-36 text-base" disabled={!playing || done || lines.length === 0} onClick={tap} onKeyDown={(e) => e.key === " " && e.preventDefault()}>
              Tap
            </Button>
            <Button type="button" variant="outline" className="h-16" disabled={times.length === 0} onClick={undo} aria-label="Undo the last tap">
              <Undo2 aria-hidden="true" />
            </Button>
          </div>
        </div>
      </Card>

      {record.lyrics_waiting ? (
        <Card className="st-callout p-4" data-tone="wait">
          <p className="font-semibold">{record.waiting_from_me ? "Your new words are waiting for approval" : "A lyrics change is waiting for review"}</p>
          <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap font-sans text-sm text-fg-muted">{record.lyrics_pending ?? "(no lyrics)"}</pre>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" disabled={busy} onClick={() => void approveWaiting()}>
              <Check aria-hidden="true" /> Approve these words
            </Button>
            {!record.waiting_from_me ? (
              <Link href="/staff/catalog#q-lyrics" className="cr-focus text-sm font-semibold underline">
                Send it back from Catalog
              </Link>
            ) : null}
          </div>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-base font-semibold">Words</h2>
            <span className="text-xs text-fg-muted">{lines.length} lines</span>
          </div>
          <label htmlFor="sync-words" className="sr-only">
            The song&apos;s words, one sung line per line
          </label>
          <textarea
            id="sync-words"
            className="st-words mt-2"
            value={draft}
            readOnly={lockedBy}
            spellCheck
            onChange={(e) => editWords(e.target.value)}
            aria-describedby="sync-words-hint"
          />
          <p id="sync-words-hint" className="mt-2 text-xs text-fg-muted">
            {lockedBy
              ? "Review the waiting change first, then fix the words here."
              : "One sung line per line; an empty line between verses. Fixing a word keeps its time."}
          </p>
        </Card>

        <Card className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold">
              Lines <span className="text-xs font-normal text-fg-muted">{times.length} of {lines.length} timed</span>
            </h2>
            <div className="flex gap-1">
              <Button type="button" size="sm" variant="ghost" disabled={times.length === 0} onClick={() => setTimes((was) => shiftLines(was, -NUDGE_MS))}>
                −0.1 s
              </Button>
              <Button type="button" size="sm" variant="ghost" disabled={times.length === 0} onClick={() => setTimes((was) => shiftLines(was, NUDGE_MS))}>
                +0.1 s
              </Button>
            </div>
          </div>
          <ol className="st-lines mt-2">
            {lines.map((line, i) => {
              const t = times[i];
              const lit = done ? i === now : i === times.length;
              return (
                <li key={i} data-lit={lit ? "true" : undefined} data-timed={t !== undefined ? "true" : undefined} aria-current={lit ? "true" : undefined}>
                  <span className="st-lines-time">{t === undefined ? "–" : lyricStamp(t)}</span>
                  <span className="min-w-0 flex-1">{line}</span>
                  {t !== undefined ? (
                    <button type="button" className="st-lines-retake cr-focus" onClick={() => retake(i)}>
                      Retake
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ol>
          {times.length ? (
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer text-fg-muted">Lyric file (LRC)</summary>
              <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap rounded border border-line p-3 font-mono text-xs">{lyricLrc(lines, times)}</pre>
            </details>
          ) : null}
        </Card>
      </div>

      <div className="st-savebar" data-on={action || notice || error ? "true" : undefined}>
        <div className="min-w-0 flex-1 text-sm" aria-live="polite">
          {error ? <span className="text-danger">{error}</span> : notice ? <span className="font-semibold">{notice}</span> : action ? <span className="text-fg-muted">Listeners see nothing until you save.</span> : <span className="text-fg-muted">Everything is saved.</span>}
        </div>
        {record.lyrics_timings_ms ? (
          <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void removeTimings()}>
            Remove timings
          </Button>
        ) : null}
        <Link href={`/listen/${track.id}`} className="cr-focus text-sm font-semibold underline">
          Listening room
        </Link>
        <Button type="button" disabled={busy || !action} onClick={() => void save()}>
          {action?.label ?? "Saved"}
        </Button>
      </div>
    </div>
  );
}

function LyricsSync({ trackId }: { trackId: string }) {
  const [record, setRecord] = useState<StaffLyrics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetchStaffLyrics(trackId)
      .then((r) => live && setRecord(r))
      .catch((err) => live && setError(friendlyError(err, "The song couldn't be loaded.")));
    return () => {
      live = false;
    };
  }, [trackId]);

  if (error) return <ErrorState message={error} />;
  if (!record) return <LoadingState />;
  return (
    <div className="grid gap-4">
      <div>
        <Link href="/staff/catalog" className="cr-focus inline-flex items-center gap-1 text-sm text-fg-muted hover:text-fg">
          <ArrowLeft aria-hidden="true" className="size-4" /> Catalog
        </Link>
        <h1 className="mt-1 text-2xl font-bold">{record.title}</h1>
        {record.profile_name ? <p className="text-sm text-fg-muted">{record.profile_name} · Sync lyrics</p> : null}
      </div>
      {record.status !== "RELEASED" ? (
        <ErrorState title="Not out yet" message="Only songs that are out can be synced here. Draft words are edited in the release." />
      ) : (
        <Workbench key={record.track_id} initial={record} />
      )}
    </div>
  );
}

export default function LyricsTimingPage() {
  const params = useParams<{ id: string }>();
  return <Protected>{params?.id ? <LyricsSync trackId={params.id} /> : null}</Protected>;
}
