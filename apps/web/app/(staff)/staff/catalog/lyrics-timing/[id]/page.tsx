"use client";

/*
 * Tap-to-time lyrics (owner, 2026-11-01, D-LYRICS-03). Staff play a released song and tap once as
 * each sung line starts; the listening room then brings each line in on its own time. Nothing
 * changes for listeners until Save. The taps come from the audio's own clock, not the few
 * progress reports a second, so they are as exact as the person tapping.
 */

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CircleAlert, Pause, Play, RotateCcw, Undo2 } from "lucide-react";

import { usePlayer, usePlayerProgress } from "@/components/music/player";
import { Button, Card, ErrorState, LoadingState, Protected } from "@/components/staff/kit";
import { fetchTrack, type TrackRecord } from "@/features/catalog/api";
import { saveLyricTimings } from "@/features/studio/api";
import { friendlyError } from "@/lib/error-copy";
import { lyricIndexAt, lyricLines, lyricLrc, lyricStamp, lyricTimes, shiftLines, tapLine } from "@/lib/lyrics-view";

/** How far before a line a retake starts playing, so the tap can be made in time. */
const RETAKE_LEAD_S = 3;
/** One nudge of every time, for taps that came a little late or early. */
const NUDGE_MS = 100;

function typing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
}

function Timer({ track, lines, saved }: { track: TrackRecord; lines: string[]; saved: number[] | null }) {
  const player = usePlayer();
  const { position, duration } = usePlayerProgress();
  const [times, setTimes] = useState<number[]>(saved ?? []);
  const [stored, setStored] = useState<number[] | null>(saved);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const current = player.isCurrent(track.id);
  const playing = current && player.status === "playing";
  const done = times.length === lines.length;
  const seconds = useMemo(() => (done ? lyricTimes(lines.length, times) : null), [done, lines.length, times]);
  const now = current && seconds ? lyricIndexAt(lines.length, position, duration, seconds) : -1;
  const changed = JSON.stringify(times) !== JSON.stringify(stored ?? []);

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
        // Space is the tap key everywhere on this page, even with a button focused.
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

  function retake(i: number) {
    const from = (times[i] ?? times[times.length - 1] ?? 0) / 1000 - RETAKE_LEAD_S;
    setTimes((was) => was.slice(0, i));
    setNotice(null);
    void playFrom(from);
  }

  async function save(next: number[] | null) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const out = await saveLyricTimings(track.id, next);
      setStored(out.lyrics_timings_ms);
      if (!out.lyrics_timings_ms) setTimes([]);
      setNotice(out.lyrics_timings_ms ? "Saved. The listening room now brings each line in on its time." : "Timings removed. The room paces the lines across the song again.");
    } catch (err) {
      setError(friendlyError(err, "The timings couldn't be saved."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-6">
      <Card className="p-5">
        <p className="text-sm text-muted-foreground">
          Play the song and press <kbd className="rounded border px-1.5 py-0.5 text-xs font-semibold">Space</kbd> (or the Tap button) the moment each line starts.{" "}
          <kbd className="rounded border px-1.5 py-0.5 text-xs font-semibold">Backspace</kbd> undoes the last tap. Listeners see nothing until you save.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {playing ? (
            <Button type="button" variant="outline" onClick={() => player.toggle()}>
              <Pause aria-hidden="true" /> Pause
            </Button>
          ) : (
            <Button type="button" variant="outline" onClick={() => void (current ? player.toggle() : playFrom(0))}>
              <Play aria-hidden="true" /> {current ? "Resume" : "Play"}
            </Button>
          )}
          <Button type="button" variant="outline" onClick={() => void playFrom(0)}>
            <RotateCcw aria-hidden="true" /> From the start
          </Button>
          <span className="tabular-nums text-sm text-muted-foreground" aria-live="off">
            {current ? `${lyricStamp(position * 1000)} / ${lyricStamp(duration * 1000)}` : "Not playing"}
          </span>
        </div>
        {current && player.problem ? (
          <p role="alert" className="mt-3 flex items-center gap-2 text-sm text-red-600">
            <CircleAlert aria-hidden="true" className="size-4" /> The song couldn&apos;t play here. Check that this account can play it.
          </p>
        ) : null}
        <div className="mt-5 grid gap-3 md:grid-cols-[1fr_auto] md:items-center">
          <div className="min-h-16 rounded-lg border p-4" aria-live="polite">
            {done ? (
              <>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Check: the line on time now</p>
                <p className="mt-1 text-lg font-semibold">{now >= 0 ? lines[now] : "Before the first line"}</p>
              </>
            ) : (
              <>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Next tap: line {times.length + 1} of {lines.length}
                </p>
                <p className="mt-1 text-lg font-semibold">{lines[times.length]}</p>
              </>
            )}
          </div>
          <div className="flex gap-2">
            <Button type="button" className="h-16 min-w-36 text-base" disabled={!playing || done} onClick={tap} onKeyDown={(e) => e.key === " " && e.preventDefault()}>
              Tap
            </Button>
            <Button type="button" variant="outline" className="h-16" disabled={times.length === 0} onClick={undo} aria-label="Undo the last tap">
              <Undo2 aria-hidden="true" />
            </Button>
          </div>
        </div>
      </Card>

      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">
            Lines ({times.length} of {lines.length} timed)
          </h2>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" disabled={times.length === 0} onClick={() => setTimes((was) => shiftLines(was, -NUDGE_MS))}>
              All 0.1 s earlier
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={times.length === 0} onClick={() => setTimes((was) => shiftLines(was, NUDGE_MS))}>
              All 0.1 s later
            </Button>
          </div>
        </div>
        <ol className="mt-3 divide-y">
          {lines.map((line, i) => {
            const t = times[i];
            const lit = done ? i === now : i === times.length;
            return (
              <li key={i} className={`flex items-center gap-3 py-2 ${lit ? "font-semibold" : ""}`} aria-current={lit ? "true" : undefined}>
                <span className="w-8 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{i + 1}</span>
                <span className="w-20 shrink-0 tabular-nums text-sm">{t === undefined ? "–" : lyricStamp(t)}</span>
                <span className={`min-w-0 flex-1 ${lit ? "" : "text-muted-foreground"}`}>{line}</span>
                {t !== undefined ? (
                  <button type="button" className="cr-focus shrink-0 text-xs font-semibold underline" onClick={() => retake(i)}>
                    Retake from here
                  </button>
                ) : null}
              </li>
            );
          })}
        </ol>
      </Card>

      <Card className="p-5">
        <h2 className="text-lg font-semibold">Result</h2>
        <p className="mt-1 text-sm text-muted-foreground">The timed lines as a lyric file (LRC), for checking or keeping a copy.</p>
        <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap rounded border p-3 font-mono text-xs">{times.length ? lyricLrc(lines, times) : "No taps yet"}</pre>
        {error ? <ErrorState message={error} /> : null}
        {notice ? (
          <p role="status" className="mt-3 text-sm font-semibold">
            {notice}
          </p>
        ) : null}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button type="button" disabled={busy || !done || !changed} onClick={() => void save(times)}>
            Save timings
          </Button>
          {stored ? (
            <Button type="button" variant="outline" disabled={busy} onClick={() => void save(null)}>
              Remove timings
            </Button>
          ) : null}
          <Link href={`/listen/${track.id}`} className="cr-focus self-center text-sm font-semibold underline">
            Open the listening room
          </Link>
        </div>
      </Card>
    </div>
  );
}

function LyricsTiming({ trackId }: { trackId: string }) {
  const [track, setTrack] = useState<TrackRecord | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetchTrack(trackId)
      .then((t) => live && setTrack(t))
      .catch((err) => live && setError(friendlyError(err, "The song couldn't be loaded.")));
    return () => {
      live = false;
    };
  }, [trackId]);

  const lines = useMemo(() => lyricLines(track?.lyrics), [track?.lyrics]);
  if (error) return <ErrorState message={error} />;
  if (!track) return <LoadingState />;
  return (
    <div className="grid gap-6">
      <div>
        <Link href="/staff/catalog" className="cr-focus text-sm underline">
          Catalog
        </Link>
        <h1 className="mt-2 text-2xl font-bold">Time the lyrics: {track.title}</h1>
      </div>
      {lines.length === 0 ? (
        <ErrorState title="No lyrics to time" message="Only songs that are out and have lyrics can be timed." />
      ) : (
        <Timer key={track.id} track={track} lines={lines} saved={lyricTimes(lines.length, track.lyrics_timings_ms) ? (track.lyrics_timings_ms ?? null) : null} />
      )}
    </div>
  );
}

export default function LyricsTimingPage() {
  const params = useParams<{ id: string }>();
  return <Protected>{params?.id ? <LyricsTiming trackId={params.id} /> : null}</Protected>;
}
