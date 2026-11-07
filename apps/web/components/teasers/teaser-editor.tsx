"use client";

/*
 * Teaser Studio editor (owner, 2026-11-07, D-TEASER-00 to D-TEASER-03). The artist picks a part of the
 * song on its waveform, adds fades and a volume change, hears it, and has Corner Room make it. Nothing
 * here changes the master: these are only settings, and every version keeps its own. Corner Room
 * approves a version before fans hear it; a live teaser keeps playing while a newer one waits.
 * The API decides every action (`actions`); this page only shows what it allows.
 *
 * Layout (owner, 2026-11-07: "fits one page, clean premium minimal, glossy buttons, icon controls by
 * the waveform"): the name on one line, then one glass panel with the waveform's own toolbar (listen,
 * undo, view), the cut and its sound in one row, and the actions at the bottom. Versions fold away.
 * Styles: app/styles/modules/teaser-studio.css.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  ExternalLink,
  Headphones,
  Maximize,
  Pause,
  Play,
  Redo2,
  Repeat,
  RotateCcw,
  Save,
  Square,
  Undo2,
  Wand2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

import { Badge, Button, Card, DateTime, ErrorState, IconButton, Skeleton } from "@/components/ds";
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

/** A compact time box with its name above it; same height as the buttons beside it. */
function TimeField({ label, value, onCommit, disabled }: { label: string; value: number; onCommit: (ms: number) => void; disabled?: boolean }) {
  const id = useId();
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
    <div className="grid min-w-0 gap-1.5">
      <label htmlFor={id} className="text-xs font-semibold text-fg-muted">
        {label}
      </label>
      <input
        id={id}
        inputMode="decimal"
        title="Minutes:seconds.milliseconds"
        value={text}
        disabled={disabled}
        aria-invalid={bad || undefined}
        aria-describedby={bad ? `${id}-err` : undefined}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
        }}
        className="ts-field cr-num w-full min-w-0"
      />
      {bad ? (
        <p id={`${id}-err`} className="text-xs text-danger">
          Type a time like 1:05.250
        </p>
      ) : null}
    </div>
  );
}

/** A slider with its name and value on one line above it. */
function ShapeSlider({
  label,
  value,
  shown,
  min,
  max,
  step,
  disabled,
  onMove,
  onDone,
}: {
  label: string;
  value: number;
  shown: string;
  min: number;
  max: number;
  step: number;
  disabled: boolean;
  onMove: (v: number) => void;
  onDone: () => void;
}) {
  const id = useId();
  const clamped = Math.min(Math.max(value, min), max);
  const fill = max > min ? ((clamped - min) / (max - min)) * 100 : 0;
  return (
    <div className="grid min-w-0 gap-1.5">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <label htmlFor={id} className="font-semibold text-fg-muted">
          {label}
        </label>
        <span className="cr-num font-semibold text-fg">{shown}</span>
      </div>
      <div className="flex h-9 items-center">
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={clamped}
          disabled={disabled}
          aria-valuetext={shown}
          onChange={(e) => onMove(Number(e.target.value))}
          onPointerUp={onDone}
          onKeyUp={onDone}
          className="ts-range"
          style={{ ["--ts-fill" as string]: `${fill}%` }}
        />
      </div>
    </div>
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
      if (!window.confirm("Delete this teaser and all its versions? This can't be undone.")) return;
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
  const quietActions = otherActions.filter((a) => a === "delete" || a === "unpublish");
  const mainActions = otherActions.filter((a) => a !== "delete" && a !== "unpublish");
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

  const playingSelection = preview.state === "playing" && preview.mode === "selection";
  const playingSong = preview.state === "playing" && preview.mode === "song";
  const nameChanged = (detail.title ?? "") !== title.trim();
  const statusLine =
    preview.state === "problem"
      ? "The song couldn't play here. Try again."
      : playingSelection && !preview.boostHeard && settings.gain_cdb > 0
        ? "Your browser can't preview a volume boost: you'll hear it in the made teaser."
        : preview.state === "playing" && preview.mode !== "version"
          ? `Playing at ${formatTime(preview.positionMs)}`
          : "Fades and volume play as you change them. Click the waveform to hear the song from there.";
  // "Make the teaser" is the main step until a made version can be sent; then sending is.
  const makeIsMain = !mainActions.includes("submit");

  return (
    <div className="grid min-w-0 grid-cols-1 gap-4">
      {/* Name, state and song on one line. */}
      <div className="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-3">
        <form
          className="flex min-w-0 flex-[1_1_18rem] items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void run("rename", () => renameTeaser(detail.id, title.trim() || null));
          }}
        >
          <label htmlFor="teaser-name" className="shrink-0 text-sm font-semibold text-fg">
            Name
          </label>
          <input
            id="teaser-name"
            value={title}
            maxLength={120}
            placeholder="Chorus, Trailer, First listen (optional)"
            onChange={(e) => setTitle(e.target.value)}
            className="ts-field min-w-0 flex-1"
          />
          <Button type="submit" size="sm" variant="secondary" className="ts-glass" busy={busy === "rename"} disabled={!nameChanged}>
            <Check aria-hidden="true" /> Save name
          </Button>
        </form>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-fg-muted">
          <Badge>{TEASER_STATUS_LABEL[detail.status]}</Badge>
          <span>
            From <span className="font-semibold text-fg">{detail.track_title}</span> · <span className="cr-num">{formatLength(masterMs)}</span>
          </span>
          {detail.status === "PUBLISHED" ? (
            <Link
              href={teaserPath(detail.id)}
              className="cr-focus inline-flex items-center gap-1 font-semibold text-link hover:underline"
              target="_blank"
              rel="noopener"
            >
              Fans&apos; page <ExternalLink aria-hidden="true" className="size-3.5" />
            </Link>
          ) : null}
        </div>
      </div>

      <section aria-labelledby="teaser-part" className="ts-panel cr-cut grid min-w-0 grid-cols-1 gap-4 p-4 md:p-5">
        {/* The waveform's own toolbar: listen on the left, what is playing in the middle, edit and view on the right. */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              className="ts-key cr-cut cr-cut-sm cr-focus"
              aria-label={playingSelection ? "Pause the teaser" : "Hear the teaser"}
              title={playingSelection ? "Pause the teaser" : "Hear the teaser"}
              data-playing={playingSelection || undefined}
              aria-busy={(preview.state === "loading" && preview.mode === "selection") || undefined}
              onClick={() => (playingSelection ? preview.stop() : void preview.playSelection(settings))}
            >
              {playingSelection ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" className="translate-x-px" />}
            </button>
            <IconButton label="Play on repeat" size="sm" variant="ghost" className="ts-ctl" aria-pressed={preview.loop} onClick={() => preview.setLoop(!preview.loop)}>
              <Repeat aria-hidden="true" />
            </IconButton>
            <IconButton
              label={playingSong ? "Stop the song" : "Play the whole song from the start point"}
              size="sm"
              variant="ghost"
              className="ts-ctl"
              onClick={() => (playingSong ? preview.stop() : void preview.playSong(settings.start_ms))}
            >
              {playingSong ? <Square aria-hidden="true" /> : <Headphones aria-hidden="true" />}
            </IconButton>
          </div>

          <div className="min-w-0 flex-[1_1_12rem]">
            <h2 id="teaser-part" className="text-sm font-bold text-fg">
              Choose the part
            </h2>
            <p className="cr-num truncate text-xs text-fg-muted" role="status">
              {statusLine}
            </p>
          </div>

          <div className="flex items-center gap-0.5 max-sm:w-full max-sm:justify-between">
            <IconButton label="Undo" size="sm" variant="ghost" className="ts-ctl max-sm:w-8" onClick={() => setHistory(undo)} disabled={locked || history.past.length === 0}>
              <Undo2 aria-hidden="true" />
            </IconButton>
            <IconButton label="Redo" size="sm" variant="ghost" className="ts-ctl max-sm:w-8" onClick={() => setHistory(redo)} disabled={locked || history.future.length === 0}>
              <Redo2 aria-hidden="true" />
            </IconButton>
            <IconButton label="Back to saved" size="sm" variant="ghost" className="ts-ctl max-sm:w-8" onClick={resetToSaved} disabled={locked || !dirty}>
              <RotateCcw aria-hidden="true" />
            </IconButton>
            <span aria-hidden="true" className="mx-1.5 h-5 w-px bg-line" />
            <IconButton
              label="Zoom in"
              size="sm"
              variant="ghost"
              className="ts-ctl max-sm:w-8"
              onClick={() => setView((v) => zoomView(v, 0.5, (settings.start_ms + settings.end_ms) / 2, masterMs))}
            >
              <ZoomIn aria-hidden="true" />
            </IconButton>
            <IconButton label="Zoom out" size="sm" variant="ghost" className="ts-ctl max-sm:w-8" onClick={() => setView((v) => zoomView(v, 2, (v.fromMs + v.toMs) / 2, masterMs))}>
              <ZoomOut aria-hidden="true" />
            </IconButton>
            <IconButton label="Show the whole song" size="sm" variant="ghost" className="ts-ctl max-sm:w-8" onClick={() => setView(fullView(masterMs))}>
              <Maximize aria-hidden="true" />
            </IconButton>
            <IconButton
              label="Scroll left"
              size="sm"
              variant="ghost"
              className="ts-ctl max-sm:w-8"
              onClick={() => setView((v) => panView(v, -0.5, masterMs))}
              disabled={view.fromMs <= 0}
            >
              <ChevronLeft aria-hidden="true" />
            </IconButton>
            <IconButton
              label="Scroll right"
              size="sm"
              variant="ghost"
              className="ts-ctl max-sm:w-8"
              onClick={() => setView((v) => panView(v, 0.5, masterMs))}
              disabled={view.toMs >= masterMs}
            >
              <ChevronRight aria-hidden="true" />
            </IconButton>
          </div>
        </div>

        <div className="grid gap-1.5">
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
              className="h-36 md:h-40"
            />
          ) : waveError || wave?.status === "FAILED" ? (
            <p role="alert" className="flex h-36 items-center gap-2 text-sm text-danger md:h-40">
              <CircleAlert aria-hidden="true" className="size-4" /> The waveform couldn&apos;t be drawn. You can still type the times below.
            </p>
          ) : (
            <div className="relative">
              <Skeleton className="h-36 w-full md:h-40" />
              <p className="absolute inset-0 grid place-items-center text-sm text-fg-muted" role="status">
                Drawing the song&apos;s waveform…
              </p>
            </div>
          )}
          <p className="cr-num flex justify-between gap-2 text-[0.6875rem] text-fg-muted" aria-hidden="true">
            <span>{formatTime(view.fromMs)}</span>
            <span>{formatTime(view.toMs)}</span>
          </p>
        </div>

        {/* The cut and its sound, in one row on a wide screen. */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-[repeat(2,minmax(0,9rem))_minmax(0,5.5rem)_repeat(3,minmax(0,1fr))]">
          <TimeField label="Start" value={settings.start_ms} disabled={locked} onCommit={(ms) => change(moveHandle(settings, "start", ms, masterMs, detail.limits))} />
          <TimeField label="End" value={settings.end_ms} disabled={locked} onCommit={(ms) => change(moveHandle(settings, "end", ms, masterMs, detail.limits))} />
          <div className="grid content-start gap-1.5">
            <span className="text-xs font-semibold text-fg-muted">Length</span>
            <span className="flex h-9 items-center">
              <span className="cr-num text-base font-bold text-fg">{formatLength(settings.end_ms - settings.start_ms)}</span>
            </span>
          </div>
          <ShapeSlider
            label="Fade in"
            value={settings.fade_in_ms}
            shown={formatLength(settings.fade_in_ms)}
            min={0}
            max={fadeMax}
            step={FADE_STEP_MS}
            disabled={locked}
            onMove={(v) => change({ ...settings, fade_in_ms: v }, false)}
            onDone={() => change(settings)}
          />
          <ShapeSlider
            label="Fade out"
            value={settings.fade_out_ms}
            shown={formatLength(settings.fade_out_ms)}
            min={0}
            max={fadeMax}
            step={FADE_STEP_MS}
            disabled={locked}
            onMove={(v) => change({ ...settings, fade_out_ms: v }, false)}
            onDone={() => change(settings)}
          />
          <ShapeSlider
            label="Volume"
            value={settings.gain_cdb}
            shown={formatGain(settings.gain_cdb)}
            min={detail.limits.gain_min_cdb}
            max={detail.limits.gain_max_cdb}
            step={GAIN_STEP_CDB}
            disabled={locked}
            onMove={(v) => change({ ...settings, gain_cdb: v }, false)}
            onDone={() => change(settings)}
          />
        </div>
        <p className="text-xs text-fg-muted">
          {limitsLine(detail.limits)} Drag the bright part or its edges, or use the arrow keys on an edge (Shift for whole seconds). Fans&apos;
          players still even out loudness.
        </p>

        {/* Make and publish: what the API allows on the right, what is happening on the left. */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
          <div className="min-w-0 flex-[1_1_18rem] text-sm">
            {error ? (
              <p role="alert" className="flex items-start gap-2 text-danger">
                <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" /> {error}
              </p>
            ) : latest?.status === "FAILED" ? (
              <p role="alert" className="flex items-start gap-2 text-danger">
                <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" /> {failureWords(latest.failure_code)} Your settings are kept:
                press Make the teaser to try again.
              </p>
            ) : processing ? (
              <p className="text-fg" role="status">
                Making the teaser from your master. This page updates by itself.
              </p>
            ) : waiting ? (
              <p className="text-fg">Corner Room is checking this version. Take it back from review to change it.</p>
            ) : dirty && makesNewVersion && !locked ? (
              <p className="text-fg-muted">Saving makes a new version.{live ? " The live teaser keeps playing until the new one is approved." : ""}</p>
            ) : latest ? (
              <p className="text-fg-muted">{versionLine(latest)}</p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {quietActions.map((action) => (
              <Button key={action} size="sm" variant="ghost" className="ts-ctl" onClick={() => void act(action)} busy={busy === action}>
                {ACTION_LABEL[action]}
              </Button>
            ))}
            <Button size="sm" variant="secondary" className="ts-glass" onClick={() => void save()} busy={busy === "save"} disabled={locked || !dirty}>
              <Save aria-hidden="true" /> Save settings
            </Button>
            {detail.actions.includes("process") || dirty ? (
              <Button
                size="sm"
                variant={makeIsMain ? "primary" : "secondary"}
                className={makeIsMain ? "ts-gloss" : "ts-glass"}
                onClick={() => void make()}
                busy={busy === "process"}
                disabled={locked}
              >
                <Wand2 aria-hidden="true" /> Make the teaser
              </Button>
            ) : null}
            {mainActions.map((action) => (
              <Button
                key={action}
                size="sm"
                variant={action === "withdraw" ? "secondary" : "primary"}
                className={action === "withdraw" ? "ts-glass" : "ts-gloss"}
                onClick={() => void act(action)}
                busy={busy === action}
                disabled={dirty && action === "submit"}
              >
                {ACTION_LABEL[action]}
              </Button>
            ))}
          </div>
        </div>
      </section>

      {latest?.review_status === "RETURNED" && latest.review_note ? (
        <Card tone="outline" className="p-4 text-sm text-fg">
          <p className="font-semibold">Corner Room sent it back</p>
          <p className="mt-1">{latest.review_note}</p>
        </Card>
      ) : null}

      <details className="ts-panel cr-cut group px-4 py-3 md:px-5">
        <summary className="cr-focus flex cursor-pointer list-none items-center justify-between gap-3 text-sm [&::-webkit-details-marker]:hidden">
          <span className="font-bold text-fg">
            Versions <span className="cr-num font-semibold text-fg-muted">({detail.versions.length})</span>
          </span>
          <span className="flex items-center gap-3 text-xs text-fg-muted">
            {detail.status === "PUBLISHED" || detail.status === "UNPUBLISHED" ? (
              <span className="cr-num">
                {detail.counts.starts} starts · {detail.counts.completes} full listens · {detail.counts.prompt_clicks} buy presses
              </span>
            ) : null}
            <ChevronDown aria-hidden="true" className="size-4 transition-transform group-open:rotate-180" />
          </span>
        </summary>
        <ol className="mt-3 grid gap-2">
          {detail.versions.map((v) => (
            <li key={v.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-2 text-sm first:border-t-0 first:pt-0">
              <div className="min-w-0">
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
              <div className="flex items-center gap-1">
                {!locked && !sameSettings(settingsOf(v), settings) ? (
                  <Button size="sm" variant="ghost" className="ts-ctl" onClick={() => change(settingsOf(v))}>
                    Use these settings
                  </Button>
                ) : null}
                {v.status === "READY" ? (
                  preview.state === "playing" && preview.mode === "version" ? (
                    <IconButton label="Stop" size="sm" variant="ghost" className="ts-ctl" onClick={preview.stop}>
                      <Square aria-hidden="true" />
                    </IconButton>
                  ) : (
                    <IconButton
                      label={`Hear version ${v.number} as fans will`}
                      size="sm"
                      variant="ghost"
                      className="ts-ctl"
                      onClick={() => void preview.playVersion(detail.id, v.id)}
                    >
                      <Play aria-hidden="true" />
                    </IconButton>
                  )
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}

export function TeaserEditor({ teaserId, releaseId }: { teaserId: string; releaseId: string }) {
  const teaser = useAsync(() => fetchTeaser(teaserId), [teaserId]);
  return (
    <div>
      <Link href={`/studio/releases/${releaseId}/teasers`} className="cr-focus mb-4 inline-flex items-center gap-1 text-sm font-semibold text-link hover:underline">
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
