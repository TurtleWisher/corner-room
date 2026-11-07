"use client";

/*
 * Teaser Studio editor (owner, 2026-11-07, D-TEASER-00 to D-TEASER-03). The artist picks a part of the
 * song on its waveform, adds fades and a volume change, hears it, and has Corner Room make it. Nothing
 * here changes the master: these are only settings, and every version keeps its own. Corner Room
 * approves a version before fans hear it; a live teaser keeps playing while a newer one waits.
 * The API decides every action (`actions`); this page only shows what it allows.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Headphones,
  Maximize,
  Play,
  Redo2,
  RotateCcw,
  Save,
  Square,
  Undo2,
  Wand2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

import { Badge, Button, Card, DateTime, ErrorState, Field, Input, Skeleton } from "@/components/ds";
import { RetryButton } from "@/components/shell/staff-panel";
import { loadErrorMessage, useAsync } from "@/components/use-async";
import { TeaserWaveform } from "@/components/teasers/waveform";
import { useStudioPreview } from "@/components/teasers/use-studio-preview";
import {
  deleteTeaser,
  fetchTeaser,
  fetchWaveform,
  processTeaser,
  renameTeaser,
  saveTeaserDraft,
  transitionTeaser,
  type TeaserAction,
  type TeaserDetailRecord,
  type TeaserSettings,
  type WaveformRecord,
} from "@/features/teasers/api";
import { ApiError } from "@/lib/api";
import { friendlyError } from "@/lib/error-copy";
import {
  ACTION_LABEL,
  failureWords,
  fitSettings,
  FADE_STEP_MS,
  formatGain,
  formatLength,
  formatTime,
  fullView,
  GAIN_STEP_CDB,
  limitsLine,
  maxFadeMs,
  moveHandle,
  panView,
  parseTime,
  problemWords,
  record,
  redo,
  replacePresent,
  sameSettings,
  settingsOf,
  startHistory,
  TEASER_STATUS_LABEL,
  undo,
  versionLine,
  zoomView,
  type History,
  type View,
} from "@/lib/teaser-editor-view";
import { teaserPath } from "@/lib/teaser-room-view";

const POLL_MS = 3000;

function errorText(err: unknown): string {
  if (err instanceof ApiError && err.code === "TEASER_SETTINGS_INVALID") {
    const words = problemWords(err.problem.detail);
    if (words.length > 0) return words.join(" ");
  }
  if (err instanceof ApiError && (err.code === "MASTER_NOT_READY" || err.code === "MASTER_CHANGED" || err.code === "TEASER_IN_REVIEW")) {
    return err.problem.title ?? err.message;
  }
  return friendlyError(err);
}

function TimeField({ label, value, onCommit, disabled }: { label: string; value: number; onCommit: (ms: number) => void; disabled?: boolean }) {
  const [text, setText] = useState(formatTime(value));
  const [bad, setBad] = useState(false);
  useEffect(() => {
    setText(formatTime(value));
    setBad(false);
  }, [value]);
  const commit = () => {
    const ms = parseTime(text);
    if (ms === null) {
      setBad(true);
      return;
    }
    setBad(false);
    onCommit(ms);
  };
  return (
    <Field label={label} hint="Minutes:seconds.milliseconds" error={bad ? "Type a time like 1:05.250" : undefined} className="min-w-40 flex-1">
      {(c) => (
        <Input
          {...c}
          inputMode="decimal"
          value={text}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
          }}
          className="cr-num"
        />
      )}
    </Field>
  );
}

function Editor({ initial, releaseId }: { initial: TeaserDetailRecord; releaseId: string }) {
  const router = useRouter();
  const [detail, setDetail] = useState(initial);
  const masterMs = detail.master.duration_ms ?? 0;
  const latest = detail.versions[0] ?? null;
  const saved = useMemo(() => (latest ? settingsOf(latest) : null), [latest]);
  const [history, setHistory] = useState<History>(() =>
    startHistory(fitSettings(saved ?? { start_ms: 0, end_ms: masterMs, fade_in_ms: 0, fade_out_ms: 0, gain_cdb: 0 }, masterMs, detail.limits)),
  );
  const settings = history.present;
  const [view, setView] = useState<View>(() => fullView(masterMs));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState(detail.title ?? "");
  const [wave, setWave] = useState<WaveformRecord | null>(null);
  const [waveError, setWaveError] = useState(false);
  const preview = useStudioPreview(detail.track_id);
  const { update: updatePreview } = preview;

  const waiting = latest?.review_status === "WAITING";
  const processing = latest?.status === "PROCESSING";
  const locked = waiting || processing;
  const dirty = !sameSettings(settings, saved);
  const makesNewVersion = latest !== null && (latest.status !== "DRAFT" || latest.is_live);
  const fadeMax = maxFadeMs(settings.end_ms - settings.start_ms, detail.limits);

  useEffect(() => updatePreview(settings), [settings, updatePreview]);

  // The waveform is made once by Corner Room's worker: ask again until it is there.
  useEffect(() => {
    let stop = false;
    let timer = 0;
    const load = async () => {
      try {
        const w = await fetchWaveform(detail.track_id);
        if (stop) return;
        setWave(w);
        setWaveError(false);
        if (w.status === "PENDING") timer = window.setTimeout(load, POLL_MS);
      } catch {
        if (!stop) setWaveError(true);
      }
    };
    void load();
    return () => {
      stop = true;
      window.clearTimeout(timer);
    };
  }, [detail.track_id]);

  // While a version is being made, look again every few seconds.
  useEffect(() => {
    if (!processing) return;
    const timer = window.setInterval(() => {
      void fetchTeaser(detail.id).then(setDetail).catch(() => undefined);
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [processing, detail.id]);

  const change = useCallback(
    (next: TeaserSettings, commit = true) => {
      const fitted = fitSettings(next, masterMs, detail.limits);
      setHistory((h) => (commit ? record(h, fitted) : replacePresent(h, fitted)));
    },
    [masterMs, detail.limits],
  );

  const run = async (key: string, task: () => Promise<TeaserDetailRecord | void>) => {
    setBusy(key);
    setError(null);
    try {
      const next = await task();
      if (next) setDetail(next);
      return next;
    } catch (err) {
      setError(errorText(err));
      return undefined;
    } finally {
      setBusy(null);
    }
  };

  const save = () => run("save", () => saveTeaserDraft(detail.id, settings));
  const make = () =>
    run("process", async () => {
      if (dirty || !latest || latest.status === "READY") await saveTeaserDraft(detail.id, settings);
      return processTeaser(detail.id);
    });
  const act = (action: TeaserAction) => {
    if (action === "process") return make();
    if (action === "delete") {
      if (!window.confirm("Delete this teaser? This can't be undone.")) return;
      return run("delete", async () => {
        await deleteTeaser(detail.id);
        router.push(`/studio/releases/${releaseId}/teasers`);
      });
    }
    return run(action, () => transitionTeaser(detail.id, action));
  };

  const resetToSaved = () => {
    if (saved) change(saved);
  };

  const otherActions = detail.actions.filter((a) => a !== "process");
  const live = detail.versions.find((v) => v.is_live) ?? null;

  if (detail.master.status !== "READY" || masterMs <= 0) {
    return (
      <Card tone="outline" className="p-5 text-sm text-fg">
        <p className="font-semibold">The song&apos;s master isn&apos;t ready.</p>
        <p className="mt-1 text-fg-muted">A teaser is cut from the song&apos;s checked master. Upload it in the release first.</p>
        <Link href={`/studio/releases/${releaseId}`} className="cr-focus mt-3 inline-block font-semibold text-link underline">
          Open the release
        </Link>
      </Card>
    );
  }

  return (
    <div className="grid gap-8">
      <div className="flex flex-wrap items-center gap-3">
        <Badge>{TEASER_STATUS_LABEL[detail.status]}</Badge>
        <span className="text-sm text-fg-muted">
          From <span className="font-semibold text-fg">{detail.track_title}</span> · song is {formatLength(masterMs)} long
        </span>
        {detail.status === "PUBLISHED" ? (
          <Link href={teaserPath(detail.id)} className="cr-focus text-sm font-semibold text-link underline" target="_blank" rel="noopener">
            Open the fans&apos; page
          </Link>
        ) : null}
      </div>

      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void run("rename", () => renameTeaser(detail.id, title.trim() || null));
        }}
      >
        <Field label="Name (optional)" hint="For example: Chorus, Trailer, First listen" className="min-w-64 flex-1">
          {(c) => <Input {...c} value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />}
        </Field>
        <Button type="submit" variant="secondary" busy={busy === "rename"} disabled={(detail.title ?? "") === title.trim()}>
          Save name
        </Button>
      </form>

      <section aria-labelledby="teaser-part" className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="teaser-part" className="text-xl font-bold text-fg">
            Choose the part
          </h2>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" aria-label="Zoom in" onClick={() => setView((v) => zoomView(v, 0.5, (settings.start_ms + settings.end_ms) / 2, masterMs))}>
              <ZoomIn aria-hidden="true" />
            </Button>
            <Button size="sm" variant="ghost" aria-label="Zoom out" onClick={() => setView((v) => zoomView(v, 2, (v.fromMs + v.toMs) / 2, masterMs))}>
              <ZoomOut aria-hidden="true" />
            </Button>
            <Button size="sm" variant="ghost" aria-label="Show the whole song" onClick={() => setView(fullView(masterMs))}>
              <Maximize aria-hidden="true" />
            </Button>
            <Button size="sm" variant="ghost" aria-label="Scroll left" onClick={() => setView((v) => panView(v, -0.5, masterMs))} disabled={view.fromMs <= 0}>
              <ChevronLeft aria-hidden="true" />
            </Button>
            <Button size="sm" variant="ghost" aria-label="Scroll right" onClick={() => setView((v) => panView(v, 0.5, masterMs))} disabled={view.toMs >= masterMs}>
              <ChevronRight aria-hidden="true" />
            </Button>
          </div>
        </div>
        {wave?.status === "READY" ? (
          <TeaserWaveform
            points={wave.points}
            bucketMs={wave.bucket_ms}
            masterMs={masterMs}
            view={view}
            settings={settings}
            limits={detail.limits}
            playheadMs={preview.state === "playing" && preview.mode !== "version" ? preview.positionMs : null}
            onChange={(next, commit) => !locked && change(next, commit)}
            onSeek={(ms) => void preview.playSong(ms)}
          />
        ) : waveError || wave?.status === "FAILED" ? (
          <p role="alert" className="flex items-center gap-2 text-sm text-danger">
            <CircleAlert aria-hidden="true" className="size-4" /> The waveform couldn&apos;t be drawn. You can still type the times below.
          </p>
        ) : (
          <div className="grid gap-2">
            <Skeleton className="h-40 w-full md:h-48" />
            <p className="text-sm text-fg-muted" role="status">
              Drawing the song&apos;s waveform…
            </p>
          </div>
        )}
        <p className="cr-num flex flex-wrap justify-between gap-2 text-xs text-fg-muted" aria-hidden="true">
          <span>{formatTime(view.fromMs)}</span>
          <span>{formatTime(view.toMs)}</span>
        </p>
        <div className="flex flex-wrap items-start gap-3">
          <TimeField label="Start" value={settings.start_ms} disabled={locked} onCommit={(ms) => change(moveHandle(settings, "start", ms, masterMs, detail.limits))} />
          <TimeField label="End" value={settings.end_ms} disabled={locked} onCommit={(ms) => change(moveHandle(settings, "end", ms, masterMs, detail.limits))} />
          <div className="min-w-32 pt-7 text-sm">
            <span className="text-fg-muted">Length </span>
            <span className="cr-num font-semibold text-fg">{formatLength(settings.end_ms - settings.start_ms)}</span>
          </div>
        </div>
        <p className="text-xs text-fg-muted">
          {limitsLine(detail.limits)} Drag the bright part or its edges, or use the arrow keys on an edge (Shift for whole seconds).
        </p>
      </section>

      <section aria-labelledby="teaser-sound" className="grid gap-4 md:grid-cols-3">
        <h2 id="teaser-sound" className="text-xl font-bold text-fg md:col-span-3">
          Shape the sound
        </h2>
        <Field label={`Fade in · ${formatLength(settings.fade_in_ms)}`} hint={`Up to ${formatLength(fadeMax)}`}>
          {(c) => (
            <input
              {...c}
              type="range"
              min={0}
              max={fadeMax}
              step={FADE_STEP_MS}
              value={Math.min(settings.fade_in_ms, fadeMax)}
              disabled={locked}
              aria-valuetext={formatLength(settings.fade_in_ms)}
              onChange={(e) => change({ ...settings, fade_in_ms: Number(e.target.value) }, false)}
              onPointerUp={() => change(settings)}
              onKeyUp={() => change(settings)}
              className="cr-focus h-6 w-full accent-highlight"
            />
          )}
        </Field>
        <Field label={`Fade out · ${formatLength(settings.fade_out_ms)}`} hint={`Up to ${formatLength(fadeMax)}`}>
          {(c) => (
            <input
              {...c}
              type="range"
              min={0}
              max={fadeMax}
              step={FADE_STEP_MS}
              value={Math.min(settings.fade_out_ms, fadeMax)}
              disabled={locked}
              aria-valuetext={formatLength(settings.fade_out_ms)}
              onChange={(e) => change({ ...settings, fade_out_ms: Number(e.target.value) }, false)}
              onPointerUp={() => change(settings)}
              onKeyUp={() => change(settings)}
              className="cr-focus h-6 w-full accent-highlight"
            />
          )}
        </Field>
        <Field label={`Volume · ${formatGain(settings.gain_cdb)}`} hint="Fans' players still even out loudness">
          {(c) => (
            <input
              {...c}
              type="range"
              min={detail.limits.gain_min_cdb}
              max={detail.limits.gain_max_cdb}
              step={GAIN_STEP_CDB}
              value={settings.gain_cdb}
              disabled={locked}
              aria-valuetext={formatGain(settings.gain_cdb)}
              onChange={(e) => change({ ...settings, gain_cdb: Number(e.target.value) }, false)}
              onPointerUp={() => change(settings)}
              onKeyUp={() => change(settings)}
              className="cr-focus h-6 w-full accent-highlight"
            />
          )}
        </Field>
      </section>

      <section aria-labelledby="teaser-listen" className="grid gap-3">
        <h2 id="teaser-listen" className="text-xl font-bold text-fg">
          Listen
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          {preview.state === "playing" && preview.mode === "selection" ? (
            <Button onClick={preview.stop}>
              <Square aria-hidden="true" /> Stop
            </Button>
          ) : (
            <Button onClick={() => void preview.playSelection(settings)} busy={preview.state === "loading" && preview.mode === "selection"}>
              <Play aria-hidden="true" /> Hear the teaser
            </Button>
          )}
          <label className="flex items-center gap-2 text-sm text-fg">
            <input type="checkbox" className="cr-focus size-4" checked={preview.loop} onChange={(e) => preview.setLoop(e.target.checked)} />
            Play it on repeat
          </label>
          {preview.state === "playing" && preview.mode === "song" ? (
            <Button variant="secondary" onClick={preview.stop}>
              <Square aria-hidden="true" /> Stop the song
            </Button>
          ) : (
            <Button variant="secondary" onClick={() => void preview.playSong(settings.start_ms)}>
              <Headphones aria-hidden="true" /> Whole song from the start point
            </Button>
          )}
        </div>
        <p className="text-sm text-fg-muted" role="status">
          {preview.state === "problem"
            ? "The song couldn't play here. Try again."
            : preview.state === "playing" && preview.mode === "selection" && !preview.boostHeard && settings.gain_cdb > 0
              ? "Your browser can't preview a volume boost: you'll hear it in the made teaser."
              : preview.state === "playing" && preview.mode !== "version"
                ? `Playing at ${formatTime(preview.positionMs)}`
                : "You hear your fades and volume as you change them. Click the waveform to play the song from that point."}
        </p>
      </section>

      <section aria-labelledby="teaser-make" className="grid gap-3">
        <h2 id="teaser-make" className="text-xl font-bold text-fg">
          Make and publish
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setHistory(undo)} disabled={locked || history.past.length === 0} aria-label="Undo">
            <Undo2 aria-hidden="true" /> Undo
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setHistory(redo)} disabled={locked || history.future.length === 0} aria-label="Redo">
            <Redo2 aria-hidden="true" /> Redo
          </Button>
          <Button variant="ghost" size="sm" onClick={resetToSaved} disabled={locked || !dirty}>
            <RotateCcw aria-hidden="true" /> Back to saved
          </Button>
          <Button variant="secondary" onClick={() => void save()} busy={busy === "save"} disabled={locked || !dirty}>
            <Save aria-hidden="true" /> Save settings
          </Button>
          {detail.actions.includes("process") || dirty ? (
            <Button onClick={() => void make()} busy={busy === "process"} disabled={locked}>
              <Wand2 aria-hidden="true" /> Make the teaser
            </Button>
          ) : null}
          {otherActions.map((action) => (
            <Button
              key={action}
              variant={action === "delete" || action === "unpublish" ? "secondary" : "primary"}
              onClick={() => void act(action)}
              busy={busy === action}
              disabled={dirty && action === "submit"}
            >
              {ACTION_LABEL[action]}
            </Button>
          ))}
        </div>
        {dirty && makesNewVersion && !locked ? (
          <p className="text-sm text-fg-muted">
            Saving makes a new version. {live ? "The live teaser keeps playing until Corner Room approves the new one." : ""}
          </p>
        ) : null}
        {waiting ? <p className="text-sm text-fg">Corner Room is checking this version. Take it back from review to change it.</p> : null}
        {processing ? (
          <p className="text-sm text-fg" role="status">
            Corner Room is making the teaser from your master. This page updates by itself.
          </p>
        ) : null}
        {latest?.status === "FAILED" ? (
          <p role="alert" className="flex items-start gap-2 text-sm text-danger">
            <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" /> {failureWords(latest.failure_code)} Your settings are kept: press Make
            the teaser to try again.
          </p>
        ) : null}
        {latest?.review_status === "RETURNED" && latest.review_note ? (
          <Card tone="outline" className="p-4 text-sm text-fg">
            <p className="font-semibold">Corner Room sent it back</p>
            <p className="mt-1">{latest.review_note}</p>
          </Card>
        ) : null}
        {error ? (
          <p role="alert" className="flex items-start gap-2 text-sm text-danger">
            <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" /> {error}
          </p>
        ) : null}
      </section>

      <section aria-labelledby="teaser-versions" className="grid gap-3">
        <h2 id="teaser-versions" className="text-xl font-bold text-fg">
          Versions
        </h2>
        <ol className="grid gap-2">
          {detail.versions.map((v) => (
            <li key={v.id} className="flex flex-wrap items-center justify-between gap-3 border border-line p-3 text-sm">
              <div>
                <p className="font-semibold text-fg">{versionLine(v)}</p>
                <p className="cr-num text-xs text-fg-muted">
                  {formatTime(v.start_ms)} to {formatTime(v.end_ms)}
                  {v.published_at ? (
                    <>
                      {" "}
                      · live from <DateTime value={v.published_at} format="datetime" />
                    </>
                  ) : null}
                  {v.retired_at ? (
                    <>
                      {" "}
                      · replaced <DateTime value={v.retired_at} format="datetime" />
                    </>
                  ) : null}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {v.status === "READY" ? (
                  preview.state === "playing" && preview.mode === "version" ? (
                    <Button size="sm" variant="secondary" onClick={preview.stop}>
                      <Square aria-hidden="true" /> Stop
                    </Button>
                  ) : (
                    <Button size="sm" variant="secondary" onClick={() => void preview.playVersion(detail.id, v.id)}>
                      <Play aria-hidden="true" /> Hear as fans will
                    </Button>
                  )
                ) : null}
                {!locked && !sameSettings(settingsOf(v), settings) ? (
                  <Button size="sm" variant="ghost" onClick={() => change(settingsOf(v))}>
                    Use these settings
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
        {detail.status === "PUBLISHED" || detail.status === "UNPUBLISHED" ? (
          <p className="text-sm text-fg-muted">
            Started <span className="cr-num font-semibold text-fg">{detail.counts.starts}</span> times · listened to the end{" "}
            <span className="cr-num font-semibold text-fg">{detail.counts.completes}</span> times · buy suggestion pressed{" "}
            <span className="cr-num font-semibold text-fg">{detail.counts.prompt_clicks}</span> times
          </p>
        ) : null}
      </section>
    </div>
  );
}

export function TeaserEditor({ teaserId, releaseId }: { teaserId: string; releaseId: string }) {
  const teaser = useAsync(() => fetchTeaser(teaserId), [teaserId]);
  return (
    <div>
      <Link href={`/studio/releases/${releaseId}/teasers`} className="cr-focus mb-6 inline-flex items-center gap-1 text-sm font-semibold text-link hover:underline">
        <ArrowLeft aria-hidden="true" className="size-4" /> All teasers of this release
      </Link>
      {teaser.status === "loading" ? (
        <Skeleton className="h-96 w-full" />
      ) : teaser.status === "error" ? (
        <ErrorState title="Teaser unavailable" message={loadErrorMessage(teaser.error, "this teaser")} action={<RetryButton onClick={teaser.reload} />} />
      ) : (
        <Editor initial={teaser.data} releaseId={releaseId} />
      )}
    </div>
  );
}
