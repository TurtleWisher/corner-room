"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { LogIn, Pause, Play, ShoppingBag } from "lucide-react";

import { RoomCube } from "@/components/brand/room-cube";
import { ButtonLink } from "@/components/ds";
import {
  closeListeningSession,
  fetchTrack,
  fetchTrackAudio,
  ingestPlaybackEvent,
  openListeningSession,
  resolveMediaUrl,
  type ListeningSessionRecord,
} from "@/lib/api";
import { clock, listenedMs, playProblem, problemMessage, type PlayProblem } from "@/lib/player-model";
import { cn } from "@/lib/utils";

export type PlayerTrack = { id: string; title: string; artist?: string | null };

type PlayerState = {
  track: PlayerTrack | null;
  status: "idle" | "loading" | "playing" | "paused" | "problem";
  problem: PlayProblem | null;
  position: number;
  duration: number;
};

type PlayerApi = PlayerState & {
  play: (track: PlayerTrack | string) => Promise<void>;
  toggle: () => void;
  seek: (seconds: number) => void;
  isCurrent: (trackId: string) => boolean;
};

const PlayerContext = createContext<PlayerApi | null>(null);

function eventId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `play-${Date.now()}`;
}

/**
 * The listening room's persistent player (music.md signature 2). Mounted once in the (listen)
 * layout, so playback survives navigation inside the group. Opens a listening session per track,
 * streams the signed audio URL, reports playback on pause and end, and closes the session when
 * the track changes. Access is decided by the API; this only presents its answer.
 */
export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const session = useRef<ListeningSessionRecord | null>(null);
  const retried = useRef(false);
  const [state, setState] = useState<PlayerState>({ track: null, status: "idle", problem: null, position: 0, duration: 0 });

  const report = useCallback((completed: boolean) => {
    const s = session.current;
    const a = audio.current;
    if (!s || !a || !s.track_id) return;
    const ms = listenedMs(a.currentTime, a.duration);
    if (ms <= 0) return;
    void ingestPlaybackEvent({ client_event_id: eventId(), track_id: s.track_id, session_id: s.id, duration_ms: ms, completed }).catch(() => undefined);
  }, []);

  const closeSession = useCallback(() => {
    const s = session.current;
    session.current = null;
    if (s && s.status === "OPEN") void closeListeningSession(s.id, s.version).catch(() => undefined);
  }, []);

  const play = useCallback(
    async (input: PlayerTrack | string) => {
      const a = audio.current;
      if (!a) return;
      const meta: PlayerTrack = typeof input === "string" ? { id: input, title: "" } : input;
      if (state.track?.id === meta.id && state.status === "paused") {
        await a.play().catch(() => undefined);
        return;
      }
      report(false);
      a.pause();
      closeSession();
      retried.current = false;
      setState({ track: meta, status: "loading", problem: null, position: 0, duration: 0 });
      try {
        const [opened, row] = await Promise.all([
          openListeningSession(meta.id),
          meta.title ? Promise.resolve(null) : fetchTrack(meta.id).catch(() => null),
        ]);
        session.current = opened;
        const track = row ? { ...meta, title: row.title } : meta;
        if (!opened.audio_deliverable) {
          setState((s) => ({ ...s, track, status: "problem", problem: { kind: "unavailable" } }));
          return;
        }
        const delivery = await fetchTrackAudio(meta.id);
        a.src = resolveMediaUrl(delivery.url);
        setState((s) => ({ ...s, track }));
        await a.play();
      } catch (err) {
        setState((s) => ({ ...s, status: "problem", problem: playProblem(err) }));
      }
    },
    [closeSession, report, state.track?.id, state.status],
  );

  const toggle = useCallback(() => {
    const a = audio.current;
    if (!a || !state.track) return;
    if (a.paused) void a.play().catch(() => undefined);
    else a.pause();
  }, [state.track]);

  const seek = useCallback((seconds: number) => {
    const a = audio.current;
    if (a && Number.isFinite(seconds)) a.currentTime = seconds;
  }, []);

  // A signed URL lasts about five minutes (Q-P8-01). If the media fails, fetch a fresh one once.
  const onMediaError = useCallback(async () => {
    const a = audio.current;
    const track = state.track;
    if (!a || !track || retried.current) {
      setState((s) => (s.track ? { ...s, status: "problem", problem: { kind: "stopped" } } : s));
      return;
    }
    retried.current = true;
    try {
      const at = a.currentTime;
      const delivery = await fetchTrackAudio(track.id);
      a.src = resolveMediaUrl(delivery.url);
      a.currentTime = at;
      await a.play();
    } catch (err) {
      setState((s) => ({ ...s, status: "problem", problem: playProblem(err) }));
    }
  }, [state.track]);

  useEffect(() => () => closeSession(), [closeSession]);

  const value = useMemo<PlayerApi>(
    () => ({ ...state, play, toggle, seek, isCurrent: (id) => state.track?.id === id }),
    [state, play, toggle, seek],
  );

  return (
    <PlayerContext.Provider value={value}>
      {children}
      <audio
        ref={audio}
        preload="none"
        onPlay={() => setState((s) => ({ ...s, status: "playing", problem: null }))}
        onPause={() => {
          setState((s) => (s.status === "playing" ? { ...s, status: "paused" } : s));
          report(false);
        }}
        onEnded={() => {
          setState((s) => ({ ...s, status: "paused", position: 0 }));
          report(true);
        }}
        onTimeUpdate={(e) => {
          // Read before the updater runs: React clears currentTarget once the handler returns.
          const position = e.currentTarget.currentTime;
          setState((s) => ({ ...s, position }));
        }}
        onLoadedMetadata={(e) => {
          const duration = e.currentTarget.duration;
          setState((s) => ({ ...s, duration }));
        }}
        onError={() => void onMediaError()}
        className="hidden"
      />
    </PlayerContext.Provider>
  );
}

export function usePlayer(): PlayerApi {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error("usePlayer must be used inside PlayerProvider");
  return ctx;
}

/** usePlayer for components that may also render outside the listening room. */
export function useOptionalPlayer(): PlayerApi | null {
  return useContext(PlayerContext);
}

/**
 * Fixed player bar: glass over the Sky world, front-only cube, title and artist, play or pause,
 * a labelled scrubber with 5 s keyboard steps, elapsed and total. Sits above the phone tab bar.
 */
export function PlayerBar() {
  const p = usePlayer();
  if (!p.track) return null;
  const playing = p.status === "playing";
  const label = p.track.title || "Track";
  return (
    <>
      <div className="h-20" aria-hidden="true" />
      <section
        aria-label="Player"
        data-theme="sky"
        className="cr-scope fixed inset-x-0 bottom-16 z-40 border-t border-cr-sky/60 lg:bottom-0"
      >
        <div className="cr-glass mx-auto flex h-20 max-w-[90rem] items-center gap-3 px-3 md:gap-5 md:px-6">
          <div className="size-12 shrink-0 bg-cr-sky">
            <RoomCube front={label} side={p.track.artist || label} tone="sky" size="front" label="" className="size-full" />
          </div>
          <div className="min-w-0 flex-1 md:flex-none md:basis-56">
            <p className="truncate text-sm font-bold text-fg">{label}</p>
            <p className="truncate text-xs text-fg-muted">
              {p.status === "loading" ? "Loading" : p.status === "problem" && p.problem ? problemMessage(p.problem) : (p.track.artist ?? "")}
            </p>
          </div>
          {p.status === "problem" && p.problem ? (
            <div className="flex shrink-0 items-center gap-2">
              {p.problem.kind === "signed_out" ? (
                <ButtonLink href="/login" size="sm">
                  <LogIn aria-hidden="true" /> Sign in
                </ButtonLink>
              ) : p.problem.kind === "needs_access" ? (
                <ButtonLink href={`/tracks/${p.track.id}`} size="sm">
                  <ShoppingBag aria-hidden="true" /> Get access
                </ButtonLink>
              ) : null}
            </div>
          ) : (
            <>
              <button
                type="button"
                onClick={p.toggle}
                disabled={p.status === "loading"}
                aria-label={playing ? `Pause ${label}` : `Play ${label}`}
                className="cr-focus inline-flex size-11 shrink-0 items-center justify-center bg-accent text-on-accent disabled:opacity-50"
              >
                {playing ? <Pause aria-hidden="true" className="size-5" /> : <Play aria-hidden="true" className="size-5" />}
              </button>
              <div className="hidden min-w-0 flex-1 items-center gap-3 sm:flex">
                <span className="cr-num w-10 text-right text-xs text-fg-muted">{clock(p.position)}</span>
                <input
                  type="range"
                  min={0}
                  max={Math.max(1, Math.floor(p.duration || 0))}
                  step={5}
                  value={Math.floor(p.position)}
                  onChange={(e) => p.seek(Number(e.target.value))}
                  aria-label={`Seek in ${label}`}
                  aria-valuetext={`${clock(p.position)} of ${clock(p.duration)}`}
                  className={cn("cr-focus h-1 min-w-0 flex-1 cursor-pointer accent-[var(--cr-highlight)]")}
                />
                <span className="cr-num w-10 text-xs text-fg-muted">{clock(p.duration)}</span>
              </div>
              <Link href={`/tracks/${p.track.id}`} className="cr-focus hidden text-xs font-semibold text-link hover:underline md:inline">
                Track page
              </Link>
            </>
          )}
        </div>
      </section>
    </>
  );
}
