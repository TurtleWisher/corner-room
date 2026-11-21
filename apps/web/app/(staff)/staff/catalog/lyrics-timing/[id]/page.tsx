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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Check, CircleAlert, Pause, Play, RotateCcw, Undo2 } from "lucide-react";

import { usePlayer, usePlayerProgress } from "@/components/music/player";
import { Button, Card, ErrorState, LoadingState, Protected } from "@/components/staff/kit";
import { fetchStaffLyrics, reviewLyrics, saveLyricTimings, saveStaffLyrics, type StaffLyrics } from "@/features/studio/api";
import { friendlyError } from "@/lib/error-copy";
import { lyricIndexAt, lyricLines, lyricLrc, lyricStamp, lyricTimes, shiftLines, tapLine } from "@/lib/lyrics-view";
import { carryTimes, lineWindow, saveAction, songMark, tapMarks, tidyLyrics } from "@/lib/staff-lyrics-view";

/** How far before a line a retake starts playing, so the tap can be made in time. */
const RETAKE_LEAD_S = 3;

const TONE: Record<string, string> = {
  ok: "st-mark st-mark-ok",
  todo: "st-mark st-mark-todo",
  wait: "st-mark st-mark-wait",
  none: "st-mark",
};
/** One nudge of every time, for taps that came a little late or early. */
const NUDGE_MS = 100;

function typing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
}

/** The song as a line: where it is now, and a mark for every tap. A click jumps there. */
function Timeline({ on, position, duration, times, onSeek }: { on: boolean; position: number; duration: number; times: number[]; onSeek: (s: number) => void }) {
  const ready = on && duration > 0;
  const marks = ready ? tapMarks(times, duration) : [];
  const at = ready ? Math.min(1, position / duration) : 0;
  return (
    <div
      className="st-timeline mt-4"
      data-on={ready ? "true" : undefined}
      role="slider"
      tabIndex={ready ? 0 : -1}
      aria-label="Song position"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(position)}
      aria-valuetext={ready ? `${lyricStamp(position * 1000)} of ${lyricStamp(duration * 1000)}` : "Not playing"}
      onClick={(e) => {
        if (!ready) return;
        const box = e.currentTarget.getBoundingClientRect();
        onSeek(((e.clientX - box.left) / box.width) * duration);
      }}
      onKeyDown={(e) => {
        if (!ready || (e.key !== "ArrowRight" && e.key !== "ArrowLeft")) return;
        e.preventDefault();
        onSeek(Math.max(0, Math.min(duration, position + (e.key === "ArrowRight" ? 5 : -5))));
      }}
    >
      <span className="st-timeline-fill" style={{ ["--at" as string]: at }} />
      {marks.map((m, i) => (
        <span key={i} className="st-timeline-mark" style={{ left: `${m * 100}%` }} />
      ))}
      <span className="st-timeline-head" style={{ left: `${at * 100}%` }} />
    </div>
  );
}

/** The line before, the one to tap (or on time now) and the next, so the eye can read ahead. */
function Stage({ lines, index, done, timed }: { lines: string[]; index: number; done: boolean; timed: number }) {
  const w = lineWindow(lines, index);
  const blank = "\u00a0";
  return (
    <div className="st-sync-now" aria-live="polite" data-done={done ? "true" : undefined}>
      {lines.length === 0 ? (
        <p className="text-sm text-fg-muted">Type the words below to start.</p>
      ) : (
        <>
          <p className="st-eyebrow">{done ? "On time now" : `Next tap · line ${timed + 1} of ${lines.length}`}</p>
          <div key={index} className="st-stage">
            <p className="st-stage-side" aria-hidden="true">
              {w.before ?? blank}
            </p>
            <p className="st-sync-line">{w.now ?? (done ? "Before the first line" : blank)}</p>
            <p className="st-stage-side" aria-hidden="true">
              {w.after ?? blank}
            </p>
          </div>
        </>
      )}
      <span className="st-sync-meter" style={{ ["--done" as string]: lines.length ? timed / lines.length : 0 }} aria-hidden="true" />
    </div>
  );
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

  // The lines list keeps the lit line in view (inside the list only; the page never jumps).
  const list = useRef<HTMLOListElement>(null);
  const lit = done ? now : times.length;
  useEffect(() => {
    const box = list.current;
    const row = box?.children[lit] as HTMLElement | undefined;
    if (!box || !row) return;
    const top = row.offsetTop - box.offsetTop - box.clientHeight / 2 + row.clientHeight / 2;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    box.scrollTo({ top: Math.max(0, top), behavior: still ? "auto" : "smooth" });
  }, [lit]);

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
      } else if ((e.key === "p" || e.key === "P") && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        if (current) player.toggle();
        else void playFrom(0);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tap, undo, current, player, playFrom]);

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
      <Card className="st-sync-deck p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" className="st-play" data-on={playing ? "true" : undefined} onClick={() => void (current ? player.toggle() : playFrom(0))}>
            {playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />} {playing ? "Pause" : current ? "Resume" : "Play"}
          </Button>
          <Button type="button" variant="ghost" onClick={() => void playFrom(0)} aria-label="Play from the start">
            <RotateCcw aria-hidden="true" />
          </Button>
          <span className="tabular-nums text-sm text-fg-muted" aria-live="off">
            {current ? `${lyricStamp(position * 1000)} / ${lyricStamp(duration * 1000)}` : "Not playing"}
          </span>
          <span className="ml-auto hidden text-xs text-fg-muted sm:inline">
            <kbd className="st-kbd">Space</kbd> tap · <kbd className="st-kbd">Backspace</kbd> undo · <kbd className="st-kbd">P</kbd> play
          </span>
        </div>
        {current && player.problem ? (
          <p role="alert" className="mt-3 flex items-center gap-2 text-sm text-danger">
            <CircleAlert aria-hidden="true" className="size-4" /> The song couldn&apos;t play here. Check that this account can play it.
          </p>
        ) : null}
        <Timeline on={current} position={position} duration={duration} times={times} onSeek={(s) => void playFrom(s)} />
        <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto] md:items-stretch">
          <Stage lines={lines} index={lit} done={done} timed={times.length} />
          <div className="flex gap-2 md:flex-col">
            <Button
              type="button"
              className="st-tap h-16 min-w-36 flex-1 text-base"
              disabled={!playing || done || lines.length === 0}
              onClick={tap}
              onKeyDown={(e) => e.key === " " && e.preventDefault()}
            >
              {times.length ? <span key={times.length} className="st-tap-ring" aria-hidden="true" /> : null}
              Tap
            </Button>
            <Button type="button" variant="outline" className="h-16 md:h-10" disabled={times.length === 0} onClick={undo} aria-label="Undo the last tap">
              <Undo2 aria-hidden="true" />
            </Button>
          </div>
        </div>
        {!playing && !done && lines.length > 0 ? <p className="mt-3 text-xs text-fg-muted">Press Play, then tap as each line starts.</p> : null}
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
          <ol ref={list} className="st-lines mt-2">
            {lines.map((line, i) => {
              const t = times[i];
              const isLit = i === lit;
              return (
                <li key={i} data-lit={isLit ? "true" : undefined} data-timed={t !== undefined ? "true" : undefined} aria-current={isLit ? "true" : undefined}>
                  <span key={t ?? "none"} className="st-lines-time">
                    {t === undefined ? "–" : lyricStamp(t)}
                  </span>
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
  const mark = songMark({
    lines: lyricLines(record.lyrics).length,
    timed: (record.lyrics_timings_ms?.length ?? 0) > 0,
    lyrics_waiting: record.lyrics_waiting,
  });
  return (
    <div className="st-sync-page grid gap-4">
      <div>
        <Link href="/staff/catalog" className="cr-focus inline-flex items-center gap-1 text-sm text-fg-muted hover:text-fg">
          <ArrowLeft aria-hidden="true" className="size-4" /> Catalog
        </Link>
        <h1 className="st-sync-title mt-1 text-2xl font-bold">{record.title}</h1>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fg-muted">
          <span>{record.profile_name ? `${record.profile_name} · Sync lyrics` : "Sync lyrics"}</span>
          <span className={TONE[mark.tone]}>{mark.label}</span>
        </p>
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
