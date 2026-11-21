"use client";

/*
 * Lyrics sync (owner, 2026-11-01, D-LYRICS-03; words on the same page 2026-11-21, D-LYRICS-04;
 * line ends 2026-11-21, D-LYRICS-05). Staff play a released song and hold the tap key while each
 * line is sung: pressing marks where the line starts, letting go where it ends. A quick tap leaves
 * the line running until the next press, and one more tap after the last line ends the song. The
 * listening room then brings each line in on its time and lets it go quiet when its singing ends.
 * The words can be fixed right here (wording, spacing, lines): they are the song's own lyrics, so
 * the song page, the listening room and Studio show the fix once it is saved. A fix with the same
 * number of lines keeps every time; adding or removing a line keeps the times before it. Taps come
 * from the audio's own clock, so they are as exact as the person.
 */

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Check, CircleAlert, Pause, Play, RotateCcw, Undo2 } from "lucide-react";

import { usePlayer, usePlayerProgress } from "@/components/music/player";
import { Button, Card, ErrorState, LoadingState, Protected } from "@/components/staff/kit";
import { fetchStaffLyrics, reviewLyrics, saveLyricTimings, saveStaffLyrics, type StaffLyrics } from "@/features/studio/api";
import { friendlyError } from "@/lib/error-copy";
import { lyricEnds, lyricIndexAt, lyricLines, lyricLrc, lyricStamp, lyricTimes, lyricVoice } from "@/lib/lyrics-view";
import {
  canPress,
  carryTimes,
  isOpen,
  lineWindow,
  loadTaps,
  pressTap,
  releaseTap,
  saveAction,
  shiftTaps,
  songMark,
  tapSpans,
  tapsBefore,
  tapsDone,
  tidyLyrics,
  type Taps,
} from "@/lib/staff-lyrics-view";

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

/** The song as a line: where it is now, and a bar for every line where it is sung. A click jumps there. */
function Timeline({ on, position, duration, taps, onSeek }: { on: boolean; position: number; duration: number; taps: Taps; onSeek: (s: number) => void }) {
  const ready = on && duration > 0;
  const spans = ready ? tapSpans(taps, duration) : [];
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
      {spans.map((s, i) => {
        // A line still open runs on to where the song is now.
        const to = s.to ?? Math.max(s.from, at);
        return (
          <span
            key={i}
            className="st-timeline-span"
            data-open={s.to === null ? "true" : undefined}
            style={{ left: `${s.from * 100}%`, width: `${Math.max(0, to - s.from) * 100}%` }}
          />
        );
      })}
      <span className="st-timeline-head" style={{ left: `${at * 100}%` }} />
    </div>
  );
}

/** What the next press of the tap key does, in a few words above the lines. */
function stageWords(o: { lines: number; started: number; open: boolean; holding: boolean; done: boolean }): string {
  if (o.done) return "On time now";
  if (o.holding) return `Singing line ${o.started} · let go as it ends`;
  if (o.started >= o.lines && o.open) return "Last line · tap once more as it ends";
  return `Next · line ${o.started + 1} of ${o.lines}`;
}

/** The line before, the one to tap (or on time now) and the next, so the eye can read ahead. */
function Stage({ lines, index, words, done, quiet, holding, share }: { lines: string[]; index: number; words: string; done: boolean; quiet: boolean; holding: boolean; share: number }) {
  const w = lineWindow(lines, index);
  const blank = " ";
  return (
    <div className="st-sync-now" aria-live="polite" data-done={done ? "true" : undefined}>
      {lines.length === 0 ? (
        <p className="text-sm text-fg-muted">Type the words below to start.</p>
      ) : (
        <>
          <p className="st-eyebrow">{words}</p>
          <div key={index} className="st-stage">
            <p className="st-stage-side" aria-hidden="true">
              {w.before ?? blank}
            </p>
            <p className="st-sync-line" data-quiet={quiet ? "true" : undefined} data-holding={holding ? "true" : undefined}>
              {w.now ?? (done ? "Before the first line" : blank)}
            </p>
            <p className="st-stage-side" aria-hidden="true">
              {w.after ?? blank}
            </p>
          </div>
        </>
      )}
      <span className="st-sync-meter" style={{ ["--done" as string]: share }} aria-hidden="true" />
    </div>
  );
}

function Workbench({ initial }: { initial: StaffLyrics }) {
  const player = usePlayer();
  const { position, duration } = usePlayerProgress();
  const [record, setRecord] = useState(initial);
  const [draft, setDraft] = useState(initial.lyrics ?? "");
  const [taps, setTaps] = useState<Taps>(() => loadTaps(initial.lyrics_timings_ms, initial.lyrics_line_ends_ms ?? null));
  const [holding, setHolding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Song time (ms) when the held press started a line; null while nothing is held.
  const pressedAt = useRef<number | null>(null);

  const { times, ends } = taps;
  const track = { id: record.track_id, title: record.title };
  const lines = useMemo(() => lyricLines(draft), [draft]);
  const current = player.isCurrent(track.id);
  const playing = current && player.status === "playing";
  const done = tapsDone(taps, lines.length);
  const open = isOpen(taps);
  const pressable = playing && canPress(taps, lines.length);
  const seconds = useMemo(() => (done ? lyricTimes(lines.length, times) : null), [done, lines.length, times]);
  const endSeconds = useMemo(() => lyricEnds(seconds, done ? ends : null), [seconds, done, ends]);
  const now = current && seconds ? lyricIndexAt(lines.length, position, duration, seconds) : -1;
  const quiet = done && now >= 0 && lyricVoice(seconds, endSeconds, now, position) < 0.99;
  const lockedBy = record.lyrics_waiting && !record.waiting_from_me;
  const action = lockedBy
    ? null
    : saveAction({
        draft,
        live: record.lyrics,
        times,
        stored: record.lyrics_timings_ms,
        ends,
        storedEnds: record.lyrics_line_ends_ms ?? null,
        approvesAtOnce: record.approves_at_once,
      });
  const startsOnly = Boolean(record.lyrics_timings_ms?.length) && !record.lyrics_line_ends_ms;

  // The line being worked on: the one held (or still open at the end), else the next to start.
  const lit = done ? now : holding || (open && times.length >= lines.length) ? times.length - 1 : times.length;

  // The lines list keeps the lit line in view (inside the list only; the page never jumps).
  const list = useRef<HTMLOListElement>(null);
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

  /** The tap key goes down: the open line ends here and the next one starts. */
  const press = useCallback(() => {
    if (!pressable || pressedAt.current !== null) return;
    const at = player.exactPosition() * 1000;
    const starts = times.length < lines.length;
    setNotice(null);
    setTaps((was) => pressTap(was, at, lines.length));
    if (starts) {
      pressedAt.current = at;
      setHolding(true);
    }
  }, [pressable, player, times.length, lines.length]);

  /** The tap key comes up: a hold ends its line here, a quick tap leaves it running. */
  const release = useCallback(() => {
    const from = pressedAt.current;
    if (from === null) return;
    pressedAt.current = null;
    setHolding(false);
    const at = player.exactPosition() * 1000;
    setTaps((was) => releaseTap(was, from, at));
  }, [player]);

  const undo = useCallback(() => {
    pressedAt.current = null;
    setHolding(false);
    setTaps((was) => tapsBefore(was, was.times.length - 1));
  }, []);

  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      if (typing(e.target)) return;
      if (e.key === " ") {
        // Space is the tap key everywhere on this page outside the words, even with a button focused.
        e.preventDefault();
        if (!e.repeat) press();
      } else if (e.repeat) {
        return;
      } else if (e.key === "Backspace") {
        e.preventDefault();
        undo();
      } else if ((e.key === "p" || e.key === "P") && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        if (current) player.toggle();
        else void playFrom(0);
      }
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.key === " ") release();
    };
    // Leaving the window mid-hold never leaves a line held for ever.
    const onBlur = () => release();
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [press, release, undo, current, player, playFrom]);

  function editWords(next: string) {
    setTaps((was) => {
      const kept = carryTimes(lyricLines(draft), lyricLines(next), was.times);
      return { times: kept, ends: was.ends.slice(0, kept.length) };
    });
    setDraft(next);
    setNotice(null);
  }

  function retake(i: number) {
    const from = (times[i] ?? times[times.length - 1] ?? 0) / 1000 - RETAKE_LEAD_S;
    pressedAt.current = null;
    setHolding(false);
    setTaps((was) => tapsBefore(was, i));
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
        const out = await saveStaffLyrics(track.id, tidyLyrics(draft), action.times ? times : null, action.times ? ends : null);
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
      const out = await saveLyricTimings(track.id, times, ends);
      setRecord((r) => ({ ...r, lyrics_timings_ms: out.lyrics_timings_ms, lyrics_line_ends_ms: out.lyrics_line_ends_ms ?? null }));
      setNotice("Saved. The listening room now brings each line in on its time and lets it go quiet as it ends.");
    }, "The changes couldn't be saved.");

  const removeTimings = () =>
    run(async () => {
      const out = await saveLyricTimings(track.id, null);
      setRecord((r) => ({ ...r, lyrics_timings_ms: out.lyrics_timings_ms, lyrics_line_ends_ms: null }));
      setTaps({ times: [], ends: [] });
      setNotice("Timings removed. The room paces the lines across the song again.");
    }, "The timings couldn't be removed.");

  const approveWaiting = () =>
    run(async () => {
      await reviewLyrics(track.id, "approve");
      const out = await fetchStaffLyrics(track.id);
      const live = lyricLines(out.lyrics);
      const kept = carryTimes(lines, live, times);
      const keptEnds = ends.slice(0, kept.length);
      const whole = live.length > 0 && kept.length === live.length && keptEnds.length === live.length;
      // The taps made while the words waited are kept as soon as the words are live.
      if (
        whole &&
        (JSON.stringify(kept) !== JSON.stringify(out.lyrics_timings_ms ?? []) ||
          JSON.stringify(keptEnds) !== JSON.stringify(out.lyrics_line_ends_ms ?? []))
      ) {
        const timed = await saveLyricTimings(track.id, kept, keptEnds);
        out.lyrics_timings_ms = timed.lyrics_timings_ms;
        out.lyrics_line_ends_ms = timed.lyrics_line_ends_ms ?? null;
      }
      setTaps({ times: kept, ends: keptEnds });
      landed(out, "Approved. The song page, the listening room and Studio show the new words.");
    }, "The words couldn't be approved.");

  const endsMarked = ends.length;
  const share = lines.length ? (times.length + endsMarked) / (lines.length * 2) : 0;

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
            Hold <kbd className="st-kbd">Space</kbd> while a line is sung · <kbd className="st-kbd">Backspace</kbd> undo · <kbd className="st-kbd">P</kbd> play
          </span>
        </div>
        {current && player.problem ? (
          <p role="alert" className="mt-3 flex items-center gap-2 text-sm text-danger">
            <CircleAlert aria-hidden="true" className="size-4" /> The song couldn&apos;t play here. Check that this account can play it.
          </p>
        ) : null}
        <Timeline on={current} position={position} duration={duration} taps={taps} onSeek={(s) => void playFrom(s)} />
        <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto] md:items-stretch">
          <Stage
            lines={lines}
            index={lit}
            words={stageWords({ lines: lines.length, started: times.length, open, holding, done })}
            done={done}
            quiet={quiet}
            holding={holding}
            share={share}
          />
          <div className="flex gap-2 md:flex-col">
            <Button
              type="button"
              className="st-tap h-16 min-w-36 flex-1 touch-none select-none text-base"
              data-holding={holding ? "true" : undefined}
              disabled={!pressable && !holding}
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                e.currentTarget.setPointerCapture?.(e.pointerId);
                press();
              }}
              onPointerUp={release}
              onPointerCancel={release}
              onLostPointerCapture={release}
              onContextMenu={(e) => e.preventDefault()}
              onKeyDown={(e) => e.key === " " && e.preventDefault()}
            >
              {times.length + endsMarked ? <span key={times.length + endsMarked} className="st-tap-ring" aria-hidden="true" /> : null}
              {holding ? "Let go at the end" : times.length >= lines.length && open ? "End the last line" : "Hold"}
            </Button>
            <Button type="button" variant="outline" className="h-16 md:h-10" disabled={times.length === 0} onClick={undo} aria-label="Undo the last line">
              <Undo2 aria-hidden="true" />
            </Button>
          </div>
        </div>
        {!playing && !done && lines.length > 0 ? (
          <p className="mt-3 text-xs text-fg-muted">Press Play, then hold Space while each line is sung and let go as it ends. A quick tap runs the line on until the next one.</p>
        ) : null}
        {startsOnly && !done ? (
          <p className="mt-2 text-xs text-fg-muted">
            This song was synced with start times only, so each line ends where the next begins. Retake a line to hold it, or tap once more as the last line ends.
          </p>
        ) : null}
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
              : "One sung line per line; an empty line between verses. Fixing a word keeps its times."}
          </p>
        </Card>

        <Card className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold">
              Lines <span className="text-xs font-normal text-fg-muted">{Math.min(times.length, ends.length)} of {lines.length} start and end</span>
            </h2>
            <div className="flex gap-1">
              <Button type="button" size="sm" variant="ghost" disabled={times.length === 0} onClick={() => setTaps((was) => shiftTaps(was, -NUDGE_MS))}>
                −0.1 s
              </Button>
              <Button type="button" size="sm" variant="ghost" disabled={times.length === 0} onClick={() => setTaps((was) => shiftTaps(was, NUDGE_MS))}>
                +0.1 s
              </Button>
            </div>
          </div>
          <ol ref={list} className="st-lines mt-2">
            {lines.map((line, i) => {
              const t = times[i];
              const end = ends[i];
              const isLit = i === lit;
              const held = holding && i === times.length - 1;
              return (
                <li
                  key={i}
                  data-lit={isLit ? "true" : undefined}
                  data-timed={t !== undefined ? "true" : undefined}
                  data-held={held ? "true" : undefined}
                  aria-current={isLit ? "true" : undefined}
                >
                  <span className="st-lines-times">
                    <span key={t ?? "none"} className="st-lines-time">
                      {t === undefined ? "–" : lyricStamp(t)}
                    </span>
                    {t !== undefined ? (
                      <span key={end ?? "open"} className="st-lines-end" data-open={end === undefined ? "true" : undefined}>
                        {end === undefined ? (held ? "singing" : "open") : `to ${lyricStamp(end)}`}
                      </span>
                    ) : null}
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
              <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap rounded border border-line p-3 font-mono text-xs">{lyricLrc(lines, times, ends)}</pre>
            </details>
          ) : null}
        </Card>
      </div>

      <div className="st-savebar" data-on={action || notice || error ? "true" : undefined}>
        <div className="min-w-0 flex-1 text-sm" aria-live="polite">
          {error ? (
            <span className="text-danger">{error}</span>
          ) : notice ? (
            <span className="font-semibold">{notice}</span>
          ) : action ? (
            <span className="text-fg-muted">Listeners see nothing until you save.</span>
          ) : times.length && !done ? (
            <span className="text-fg-muted">Every line needs its start and its end before the times can be saved.</span>
          ) : (
            <span className="text-fg-muted">Everything is saved.</span>
          )}
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
    line_ends: Boolean(record.lyrics_line_ends_ms?.length),
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
