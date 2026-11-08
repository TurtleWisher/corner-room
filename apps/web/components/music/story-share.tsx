"use client";

/*
 * Share as a story (owner, 2026-11-08, D-STORY-01). In the listening room, someone who owns the song
 * picks a moment of up to 30 seconds and gets a video of a liquid glass Corner Room card with that
 * moment's sound and its lyrics moving with the singing, made on their own device. On a phone the
 * share sheet offers Instagram, Facebook, WhatsApp and the rest; elsewhere the video is saved.
 *
 * Apps don't let a website put a live music sticker on a story, so the sound is part of the video.
 * The server decides who may (owners only, song out, the act's switch on, the longest moment); the
 * button only shows when it says yes. Making a video plays nothing through the player and is never a
 * listen.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CircleAlert, Copy, Download, Loader2, Pause, Play, Share2, Sparkles } from "lucide-react";

import { Button } from "@/components/ds";
import { Dialog } from "@/components/ds/dialog";
import { buttonVariants } from "@/components/ds/button";
import { usePlayer, type PlayerTrack } from "@/components/music/player";
import { fetchStoryCheck, fetchTrackAudio, resolveMediaUrl, type StoryCheckRecord } from "@/features/streaming/api";
import { fetchTrack } from "@/lib/api";
import { coverUrl } from "@/lib/cover-view";
import { friendlyError } from "@/lib/error-copy";
import { lyricIndexAt, lyricLines, lyricTimes } from "@/lib/lyrics-view";
import { drawStory, pageFonts, storyAssets, type StoryAssets } from "@/lib/story-card-draw";
import {
  clipWindow,
  clockLabel,
  defaultStartMs,
  levelsPerFrame,
  shareRoute,
  STORY_H,
  STORY_W,
  storyFileName,
  storyFrame,
  type StoryInput,
} from "@/lib/story-card-view";
import { cutClip, makeStoryVideo, monoSamples } from "@/lib/story-video";

const checks = new Map<string, Promise<StoryCheckRecord | null>>();

/** The server's answer for this song, once per song per page view. */
function useStoryCheck(trackId: string): StoryCheckRecord | null {
  const [check, setCheck] = useState<StoryCheckRecord | null>(null);
  useEffect(() => {
    let live = true;
    setCheck(null);
    let hit = checks.get(trackId);
    if (!hit) {
      hit = fetchStoryCheck(trackId).catch(() => null);
      checks.set(trackId, hit);
    }
    void hit.then((c) => live && setCheck(c));
    return () => {
      live = false;
    };
  }, [trackId]);
  return check;
}

const PREVIEW_SCALE = 0.5;
/** The still the preview shows when not playing: the card has arrived. */
const STILL_AT = 1.4;
const LOGO = "/brand/logo/corner-room-logo-mono-light.svg";

type Loaded = { song: AudioBuffer; gainDb: number; assets: StoryAssets; lyrics: string | null; timings: number[] | null; songMs: number };
type Made = { url: string; file: File; mp4: boolean };

async function loadImage(src: string): Promise<HTMLImageElement | null> {
  try {
    const img = new Image();
    img.src = src;
    await img.decode();
    return img;
  } catch {
    return null;
  }
}

/** The cover as pixels the canvas may export (fetched as bytes, so it never taints the canvas). */
async function loadCover(trackId: string): Promise<ImageBitmap | null> {
  const src = coverUrl({ track: trackId }, 1200);
  if (!src) return null;
  try {
    const res = await fetch(src);
    if (!res.ok) return null;
    return await createImageBitmap(await res.blob());
  } catch {
    return null;
  }
}

async function loadSong(ac: AudioContext, trackId: string): Promise<{ song: AudioBuffer; gainDb: number }> {
  // MP3 first: every browser decodes it.
  const delivery = await fetchTrackAudio(trackId, ["mp3", "opus"]);
  const urls = [delivery.url, ...(delivery.alternates ?? []).map((a) => a.url)];
  let last: unknown = null;
  for (const url of urls) {
    try {
      const res = await fetch(resolveMediaUrl(url));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const song = await ac.decodeAudioData(await res.arrayBuffer());
      return { song, gainDb: delivery.gain_db ?? 0 };
    } catch (err) {
      last = err;
    }
  }
  throw last ?? new Error("NO_AUDIO");
}

function Composer({ track, check, onClose }: { track: PlayerTrack; check: StoryCheckRecord; onClose: () => void }) {
  const player = usePlayer();
  const title = track.title || "Untitled";
  const artist = track.artist || "";
  const audioCtx = useRef<AudioContext | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [startMs, setStartMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [making, setMaking] = useState<number | null>(null);
  const [made, setMade] = useState<Made | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // The room's music stops while the story is made, so the two never play over each other.
  const pausedPlayer = useRef(false);
  useEffect(() => {
    if (!pausedPlayer.current && player.status === "playing") {
      pausedPlayer.current = true;
      player.toggle();
    }
  }, [player]);

  useEffect(() => {
    let live = true;
    const ac = new AudioContext();
    audioCtx.current = ac;
    (async () => {
      const [song, info, cover, logo] = await Promise.all([
        loadSong(ac, track.id),
        fetchTrack(track.id, { skipAuth: true }).catch(() => null),
        loadCover(track.id),
        loadImage(LOGO),
      ]);
      await document.fonts?.ready;
      const fonts = pageFonts();
      await Promise.all(
        [`72px ${fonts.display}`, `700 54px ${fonts.ui}`, `700 54px ${fonts.bangla}`].map((f) => document.fonts?.load(f, `${title} ${artist}`).catch(() => null)),
      );
      if (!live) return;
      const timings = info?.lyrics_timings_ms ?? null;
      const songMs = Math.round(song.song.duration * 1000);
      setStartMs(defaultStartMs(songMs, check.clip_max_ms, timings));
      setLoaded({ song: song.song, gainDb: song.gainDb, assets: storyAssets(cover, logo, fonts), lyrics: info?.lyrics ?? null, timings, songMs });
    })().catch((err) => live && setProblem(friendlyError(err, "We couldn't get the song ready. Please try again.")));
    return () => {
      live = false;
      void ac.close().catch(() => undefined);
      audioCtx.current = null;
    };
  }, [track.id, check.clip_max_ms, title, artist]);

  const window_ = loaded ? clipWindow(startMs, loaded.songMs, check.clip_max_ms) : null;
  const clip = useMemo(() => {
    if (!loaded || !window_ || !audioCtx.current) return null;
    return cutClip(audioCtx.current, loaded.song, window_.startMs, window_.endMs, loaded.gainDb);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the window is derived from these
  }, [loaded, window_?.startMs, window_?.endMs]);
  const input: StoryInput | null = useMemo(() => {
    if (!loaded || !window_ || !clip) return null;
    return {
      title,
      artist,
      lyrics: loaded.lyrics,
      lyricsTimingsMs: loaded.timings,
      songMs: loaded.songMs,
      startMs: window_.startMs,
      endMs: window_.endMs,
      levels: levelsPerFrame(monoSamples(clip), clip.sampleRate),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the window is derived from these
  }, [loaded, clip, title, artist]);

  const draw = useCallback(
    (t: number) => {
      const ctx = canvas.current?.getContext("2d");
      if (!ctx || !input || !loaded) return;
      drawStory(ctx, input, storyFrame(input, t), loaded.assets, t, PREVIEW_SCALE);
    },
    [input, loaded],
  );

  // The still, whenever the moment changes and nothing plays.
  useEffect(() => {
    if (!playing) draw(STILL_AT);
  }, [draw, playing]);

  // Playing the moment: its sound through Web Audio, the card drawn to the same clock.
  const source = useRef<AudioBufferSourceNode | null>(null);
  const frame = useRef(0);
  const stop = useCallback(() => {
    cancelAnimationFrame(frame.current);
    try {
      source.current?.stop();
    } catch {
      /* already stopped */
    }
    source.current = null;
    setPlaying(false);
  }, []);
  const play = useCallback(async () => {
    const ac = audioCtx.current;
    if (!ac || !clip) return;
    await ac.resume();
    const node = ac.createBufferSource();
    node.buffer = clip;
    node.connect(ac.destination);
    const startAt = ac.currentTime + 0.05;
    node.start(startAt);
    node.onended = () => source.current === node && stop();
    source.current = node;
    setPlaying(true);
    const tick = () => {
      draw(Math.max(0, ac.currentTime - startAt));
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  }, [clip, draw, stop]);
  useEffect(() => stop, [stop]);

  useEffect(() => {
    return () => {
      if (made) URL.revokeObjectURL(made.url);
    };
  }, [made]);

  const make = async () => {
    if (!input || !loaded || !clip) return;
    stop();
    setNote(null);
    setMade(null);
    setMaking(0);
    try {
      const video = await makeStoryVideo(input, loaded.assets, clip, setMaking, draw);
      const name = storyFileName(title).replace(/\.mp4$/, video.mp4 ? ".mp4" : ".webm");
      const file = new File([video.blob], name, { type: video.type });
      setMade({ url: URL.createObjectURL(video.blob), file, mp4: video.mp4 });
    } catch (err) {
      setProblem(
        err instanceof Error && err.message === "NO_RECORDER"
          ? "This browser can't make videos. Try Chrome, or Safari on your phone."
          : friendlyError(err, "The video didn't finish. Please try again."),
      );
    } finally {
      setMaking(null);
    }
  };

  const share = async () => {
    if (!made) return;
    try {
      await navigator.share({ files: [made.file], title: `${title} on Corner Room` });
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) setNote("Sharing didn't open. Save the video and post it from your gallery.");
    }
  };

  const songLink = typeof window === "undefined" ? `/tracks/${track.id}` : `${window.location.origin}/tracks/${track.id}`;
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(songLink);
      setNote("Song link copied. Add it to your story as a link sticker.");
    } catch {
      setNote(`Copy this link for a link sticker: ${songLink}`);
    }
  };

  const route = made ? shareRoute(typeof navigator === "undefined" ? undefined : navigator, made.file) : "download";
  const maxStart = loaded && window_ ? Math.max(0, loaded.songMs - (window_.endMs - window_.startMs)) : 0;
  const lines = lyricLines(loaded?.lyrics);
  const firstLine = (() => {
    if (!loaded || !window_ || lines.length === 0) return null;
    const i = lyricIndexAt(lines.length, window_.startMs / 1000 + 1, loaded.songMs / 1000, lyricTimes(lines.length, loaded.timings));
    return lines[Math.max(0, i)] ?? null;
  })();
  const seconds = window_ ? Math.round((window_.endMs - window_.startMs) / 1000) : Math.round(check.clip_max_ms / 1000);

  return (
    <Dialog
      open
      onClose={onClose}
      title="Share as a story"
      description={`Pick up to ${Math.round(check.clip_max_ms / 1000)} seconds. Your story plays that moment on a Corner Room card.`}
      className="sc-dialog w-[min(54rem,calc(100vw-2rem))] max-h-[calc(100dvh-2rem)]"
    >
      <div className="sc-body">
        <div className="sc-preview">
          {made ? (
            <video src={made.url} controls playsInline className="sc-canvas" aria-label={`Your story video of ${title}`} />
          ) : (
            <canvas
              ref={canvas}
              width={STORY_W * PREVIEW_SCALE}
              height={STORY_H * PREVIEW_SCALE}
              className="sc-canvas"
              role="img"
              aria-label={`Story card preview: ${title}${artist ? ` by ${artist}` : ""}`}
            />
          )}
          {!loaded && !problem ? (
            <p className="sc-wait" role="status">
              <Loader2 aria-hidden="true" className="size-5 animate-spin motion-reduce:animate-none" /> Getting your song ready
            </p>
          ) : null}
        </div>

        <div className="sc-side">
          {problem ? (
            <p role="alert" className="flex items-start gap-2 text-sm text-danger">
              <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              {problem}
            </p>
          ) : null}

          {loaded && window_ && !made ? (
            <>
              <div>
                <label htmlFor="sc-start" className="text-base font-bold text-fg">
                  Your moment
                </label>
                <p className="mt-1 text-sm text-fg-muted">
                  <span className="cr-num">{clockLabel(window_.startMs)}</span> to <span className="cr-num">{clockLabel(window_.endMs)}</span>, {seconds} seconds
                </p>
                <input
                  id="sc-start"
                  type="range"
                  min={0}
                  max={maxStart}
                  step={500}
                  value={window_.startMs}
                  disabled={making !== null || maxStart === 0}
                  onChange={(e) => {
                    stop();
                    setStartMs(Number(e.target.value));
                  }}
                  aria-valuetext={`From ${clockLabel(window_.startMs)} to ${clockLabel(window_.endMs)}`}
                  style={{ "--pct": `${maxStart > 0 ? (window_.startMs / maxStart) * 100 : 0}%` } as React.CSSProperties}
                  className="cr-focus cr-prange mt-3 w-full"
                />
                {firstLine ? <p className="sc-line">“{firstLine}”</p> : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => (playing ? stop() : void play())} disabled={making !== null}>
                  {playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
                  {playing ? "Stop" : "Play this moment"}
                </Button>
                <Button onClick={() => void make()} disabled={making !== null}>
                  {making !== null ? <Loader2 aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : <Sparkles aria-hidden="true" />}
                  {making !== null ? "Making your video" : "Make story video"}
                </Button>
              </div>
              {making !== null ? (
                <>
                  <div role="progressbar" aria-label="Making your video" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(making * 100)} className="sc-progress">
                    <span style={{ width: `${Math.round(making * 100)}%` }} />
                  </div>
                  <p className="text-sm text-fg-muted">Recording as it plays. Keep this screen open until it finishes.</p>
                </>
              ) : null}
            </>
          ) : null}

          {made ? (
            <>
              <p className="text-base font-bold text-fg">Your story is ready</p>
              <p className="text-sm text-fg-muted">
                {route === "share"
                  ? "Share it, then choose Instagram, Facebook or WhatsApp and pick Story."
                  : "Save the video, then post it to your story from your phone's gallery."}
              </p>
              {!made.mp4 ? (
                <p className="flex items-start gap-2 text-sm text-fg-muted">
                  <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                  This browser made a WebM video, which Instagram and Facebook may not take. Chrome, or Safari on a phone, makes MP4.
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                {route === "share" ? (
                  <Button onClick={() => void share()}>
                    <Share2 aria-hidden="true" /> Share
                  </Button>
                ) : null}
                <a href={made.url} download={made.file.name} className={buttonVariants({ variant: "secondary" })}>
                  <Download aria-hidden="true" className="size-4" /> Save video
                </a>
                <Button variant="ghost" onClick={() => void copyLink()}>
                  <Copy aria-hidden="true" /> Copy song link
                </Button>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setMade(null)}>
                Pick another moment
              </Button>
            </>
          ) : null}

          {note ? (
            <p role="status" className="text-sm text-fg-muted">
              {note}
            </p>
          ) : null}
        </div>
      </div>
    </Dialog>
  );
}

/** The room's "Share as story" button: there only when the server says this person may. */
export function StoryShareButton({ track }: { track: PlayerTrack }) {
  const check = useStoryCheck(track.id);
  const [open, setOpen] = useState(false);
  if (!check?.can_share) return null;
  const title = track.title || "this song";
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Share ${title} as a story`}
        title="Share as story"
        className="cr-focus cr-pctl inline-flex size-10 items-center justify-center"
      >
        <Share2 aria-hidden="true" className="size-4" />
      </button>
      {open ? <Composer track={track} check={check} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
