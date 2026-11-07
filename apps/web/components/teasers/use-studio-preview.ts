"use client";

/*
 * Teaser Studio preview (owner, 2026-11-07, D-TEASER-00). Plays the song's playback copy (never the
 * master) and applies the chosen fades and gain while it plays, with the same linear curves the
 * server uses, so what the artist hears is what the teaser will sound like. A made version plays
 * as-is. One audio element, separate from the site's player, which is paused while previewing.
 *
 * Gain above 0 dB needs Web Audio, which can only read media fetched in CORS mode; if that fails the
 * preview still plays, with fades and cuts, and says that a boost is heard in the made teaser.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { useOptionalPlayer } from "@/components/music/player";
import {
  fetchStudioSongAudio,
  fetchStudioVersionAudio,
  type TeaserAudioRecord,
  type TeaserSettings,
} from "@/features/teasers/api";
import { resolveMediaUrl } from "@/lib/api";
import { fadeLevel, gainMultiplier } from "@/lib/teaser-editor-view";
import { acceptCodecs } from "@/lib/player-model";

export type PreviewMode = "selection" | "song" | "version";
export type PreviewState = "idle" | "loading" | "playing" | "problem";

type WebAudioWindow = Window & { webkitAudioContext?: typeof AudioContext };

type Cached = { key: string; audio: TeaserAudioRecord; at: number };
const URL_LIFETIME_MS = 4 * 60_000; // signed links last about five minutes

export function useStudioPreview(trackId: string) {
  const el = useRef<HTMLAudioElement | null>(null);
  const ctx = useRef<AudioContext | null>(null);
  const gain = useRef<GainNode | null>(null);
  const corsOk = useRef(true);
  const cache = useRef<Cached | null>(null);
  const frame = useRef(0);
  const settingsRef = useRef<TeaserSettings | null>(null);
  const modeRef = useRef<PreviewMode | null>(null);
  const loopRef = useRef(false);
  const [state, setState] = useState<PreviewState>("idle");
  const [mode, setMode] = useState<PreviewMode | null>(null);
  const [positionMs, setPositionMs] = useState(0);
  const [boostHeard, setBoostHeard] = useState(true);
  const [loop, setLoopState] = useState(false);
  const player = useOptionalPlayer();
  const playerRef = useRef(player);
  playerRef.current = player;

  const stopFrames = () => {
    if (frame.current) cancelAnimationFrame(frame.current);
    frame.current = 0;
  };

  const stop = useCallback(() => {
    stopFrames();
    const a = el.current;
    if (a) a.pause();
    modeRef.current = null;
    setMode(null);
    setState("idle");
  }, []);

  useEffect(() => {
    const a = new Audio();
    a.preload = "none";
    el.current = a;
    return () => {
      stopFrames();
      a.pause();
      a.removeAttribute("src");
      a.load();
      void ctx.current?.close().catch(() => undefined);
    };
  }, []);

  /** Level for this moment: fades and gain in selection mode, untouched otherwise. */
  const applyLevel = useCallback((atMs: number) => {
    const a = el.current;
    if (!a) return;
    const s = settingsRef.current;
    const edited = modeRef.current === "selection" && s;
    const level = edited ? fadeLevel(atMs, s) * gainMultiplier(s.gain_cdb) : 1;
    if (gain.current) {
      gain.current.gain.value = level;
      a.volume = 1;
    } else {
      a.volume = Math.min(1, Math.max(0, level));
    }
  }, []);

  const tick = useCallback(() => {
    const a = el.current;
    if (!a) return;
    const ms = Math.round(a.currentTime * 1000);
    setPositionMs(ms);
    const s = settingsRef.current;
    if (modeRef.current === "selection" && s && ms >= s.end_ms) {
      if (loopRef.current) {
        a.currentTime = s.start_ms / 1000;
      } else {
        stop();
        setPositionMs(s.start_ms);
        return;
      }
    }
    applyLevel(ms);
    frame.current = requestAnimationFrame(tick);
  }, [applyLevel, stop]);

  const route = useCallback(() => {
    const a = el.current;
    if (!a || gain.current || !corsOk.current) return;
    try {
      const Ctor = window.AudioContext ?? (window as WebAudioWindow).webkitAudioContext;
      if (!Ctor) return;
      ctx.current = ctx.current ?? new Ctor();
      const source = ctx.current.createMediaElementSource(a);
      gain.current = ctx.current.createGain();
      source.connect(gain.current).connect(ctx.current.destination);
    } catch {
      gain.current = null;
    }
  }, []);

  const source = useCallback(
    async (key: string, load: () => Promise<TeaserAudioRecord>): Promise<string> => {
      const fresh = cache.current && cache.current.key === key && Date.now() - cache.current.at < URL_LIFETIME_MS;
      if (!fresh) cache.current = { key, audio: await load(), at: Date.now() };
      return resolveMediaUrl(cache.current!.audio.url);
    },
    [],
  );

  const start = useCallback(
    async (next: PreviewMode, url: string, fromMs: number) => {
      const a = el.current;
      if (!a) return;
      // One thing plays at a time: the site's player pauses while the artist previews.
      const p = playerRef.current;
      if (p && p.status === "playing") p.toggle();
      stopFrames();
      modeRef.current = next;
      setMode(next);
      setState("loading");
      if (corsOk.current) a.crossOrigin = "anonymous";
      if (a.getAttribute("src") !== url) {
        a.src = url;
      }
      try {
        route();
        if (ctx.current?.state === "suspended") await ctx.current.resume().catch(() => undefined);
        a.currentTime = fromMs / 1000;
        applyLevel(fromMs);
        await a.play();
        setState("playing");
        setBoostHeard(Boolean(gain.current));
        frame.current = requestAnimationFrame(tick);
      } catch {
        if (corsOk.current && !gain.current) {
          // Retry without CORS: cuts and fades still play, a boost waits for the made teaser.
          corsOk.current = false;
          a.removeAttribute("crossorigin");
          a.src = url;
          try {
            a.currentTime = fromMs / 1000;
            await a.play();
            setState("playing");
            setBoostHeard(false);
            frame.current = requestAnimationFrame(tick);
            return;
          } catch {
            /* fall through */
          }
        }
        modeRef.current = null;
        setMode(null);
        setState("problem");
      }
    },
    [applyLevel, route, tick],
  );

  const accept = () => {
    const probe = document.createElement("audio");
    return acceptCodecs((mime) => probe.canPlayType(mime));
  };

  /** The selection with its fades and gain, from its start (or from `fromMs` inside it). */
  const playSelection = useCallback(
    async (settings: TeaserSettings, fromMs?: number) => {
      settingsRef.current = settings;
      try {
        const url = await source(`song:${trackId}`, () => fetchStudioSongAudio(trackId, accept()));
        const from = fromMs !== undefined && fromMs >= settings.start_ms && fromMs < settings.end_ms ? fromMs : settings.start_ms;
        await start("selection", url, from);
      } catch {
        setState("problem");
      }
    },
    [source, start, trackId],
  );

  /** The whole song as it is, from a point. */
  const playSong = useCallback(
    async (fromMs: number) => {
      try {
        const url = await source(`song:${trackId}`, () => fetchStudioSongAudio(trackId, accept()));
        await start("song", url, fromMs);
      } catch {
        setState("problem");
      }
    },
    [source, start, trackId],
  );

  /** A made version, exactly as fans will hear it. */
  const playVersion = useCallback(
    async (teaserId: string, versionId: string) => {
      try {
        const url = await source(`version:${versionId}`, () => fetchStudioVersionAudio(teaserId, versionId, accept()));
        await start("version", url, 0);
      } catch {
        setState("problem");
      }
    },
    [source, start],
  );

  /** Settings changed while the selection plays: the next frame uses them. */
  const update = useCallback((settings: TeaserSettings) => {
    settingsRef.current = settings;
  }, []);

  const setLoop = useCallback((on: boolean) => {
    loopRef.current = on;
    setLoopState(on);
  }, []);

  return { state, mode, positionMs, boostHeard, loop, setLoop, playSelection, playSong, playVersion, stop, update };
}
