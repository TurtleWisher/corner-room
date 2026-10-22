"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { LogIn, Maximize2, Pause, Play, Repeat, Repeat1, ShoppingBag, Shuffle, SkipBack, SkipForward } from "lucide-react";

import { CoverArt } from "@/components/brand/cover-art";
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
import {
  acceptCodecs,
  afterEnd,
  clock,
  durationLabel,
  formatLabel,
  isAutoplayBlocked,
  isSuperseded,
  levelMultiplier,
  listenedMs,
  nextRepeat,
  outputLevels,
  playProblem,
  previousAction,
  problemMessage,
  queueFor,
  repeatLabel,
  seekTarget,
  shuffled,
  stepWithRepeat,
  type PlayProblem,
  type RepeatMode,
} from "@/lib/player-model";
import { coverUrl } from "@/lib/cover-view";
import { cn } from "@/lib/utils";

export type PlayerTrack = { id: string; title: string; artist?: string | null };

/** Where a play came from: the list becomes Up next, `source` names it ("Night Bus"). */
export type PlayOptions = { queue?: PlayerTrack[]; source?: string | null };

export type PlayerStatus = "idle" | "loading" | "playing" | "paused" | "problem";

type PlayerState = {
  track: PlayerTrack | null;
  status: PlayerStatus;
  problem: PlayProblem | null;
  /** Up next: the list the current track was played from, for this visit only. */
  queue: PlayerTrack[];
  index: number;
  source: string | null;
  /** The browser refused to start without a click (autoplay policy): the listener presses play. */
  needsGesture: boolean;
  /** Playing, but waiting for audio data. */
  buffering: boolean;
  volume: number;
  muted: boolean;
  repeat: RepeatMode;
  /** The queue is in shuffled order (the list's own order is kept to restore). */
  shuffle: boolean;
  /** "Normalise volume" (D-AUDIO-08), on by default, remembered on this device. */
  normalise: boolean;
  /** Levelling for the current track from the API; null when it was never measured. */
  gainDb: number | null;
  /** What is streaming now, e.g. "Opus · 160 kbps"; null for older demo audio. */
  format: string | null;
};

export type PlayerProgress = { position: number; duration: number };

/**
 * Playback position lives outside React state: it changes several times a second, and only the
 * scrubbers and clocks that read it (usePlayerProgress) re-render, not the whole listening room.
 */
type ProgressStore = {
  get: () => PlayerProgress;
  set: (next: Partial<PlayerProgress>) => void;
  subscribe: (listener: () => void) => () => void;
};

function createProgressStore(): ProgressStore {
  let snapshot: PlayerProgress = { position: 0, duration: 0 };
  const listeners = new Set<() => void>();
  return {
    get: () => snapshot,
    set: (next) => {
      const merged = { ...snapshot, ...next };
      if (merged.position === snapshot.position && merged.duration === snapshot.duration) return;
      snapshot = merged;
      for (const l of listeners) l();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

type PlayerApi = PlayerState & {
  hasNext: boolean;
  /** False where the device ignores page volume (iOS): the volume slider is then not offered. */
  volumeSettable: boolean;
  progress: ProgressStore;
  play: (track: PlayerTrack | string, options?: PlayOptions) => Promise<void>;
  toggle: () => void;
  seek: (seconds: number) => void;
  next: () => void;
  previous: () => void;
  setVolume: (volume: number) => void;
  toggleMute: () => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  toggleNormalise: () => void;
  /** Whether levelling can work here: element volume is ignored on some devices (iOS). */
  levellingAvailable: boolean;
  isCurrent: (trackId: string) => boolean;
};

const PlayerContext = createContext<PlayerApi | null>(null);

const VOLUME_KEY = "cr.player.volume";
const PREFS_KEY = "cr.player.prefs";

type Prefs = { shuffle: boolean; repeat: RepeatMode; normalise: boolean };

/** Shuffle, repeat and levelling, remembered on this device only (a convenience, not account data). */
function readPrefs(): Prefs {
  const fallback: Prefs = { shuffle: false, repeat: "off", normalise: true };
  try {
    const raw = JSON.parse(window.localStorage.getItem(PREFS_KEY) ?? "null") as Partial<Prefs> | null;
    if (!raw || typeof raw !== "object") return fallback;
    return {
      shuffle: raw.shuffle === true,
      repeat: raw.repeat === "all" || raw.repeat === "one" ? raw.repeat : "off",
      normalise: raw.normalise !== false,
    };
  } catch {
    return fallback;
  }
}

function writePrefs(prefs: Prefs): void {
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* storage unavailable: the choice still applies for this visit */
  }
}

type WebAudioWindow = Window & { webkitAudioContext?: typeof AudioContext };

function eventId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `play-${Date.now()}`;
}

function readVolume(): number {
  try {
    const v = Number(window.localStorage.getItem(VOLUME_KEY));
    return Number.isFinite(v) && v > 0 && v <= 1 ? v : 1;
  } catch {
    return 1;
  }
}

/**
 * The listening room's persistent player (music.md signature 2). Mounted once in the (listen)
 * layout, so playback survives navigation inside the group. One audio element is the single
 * source of truth: status follows its events, never a timer. Opens a listening session per
 * track, streams the signed audio URL, reports playback on pause, end and track change, and
 * closes the session when the track changes. Access is decided by the API; this only presents
 * its answer.
 */
export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const session = useRef<ListeningSessionRecord | null>(null);
  const lastReport = useRef<{ session: string; ms: number } | null>(null);
  // The latest playback report still on its way: a session is closed only after it lands, or
  // the API refuses the report as SESSION_CLOSED and the listen is lost.
  const inflight = useRef<Promise<unknown>>(Promise.resolve());
  const retried = useRef(false);
  // Every load gets a number; a slower, older load that finishes later is ignored.
  const loadSeq = useRef(0);
  // The list's own order while shuffle is on, to restore when it is turned off.
  const original = useRef<PlayerTrack[] | null>(null);
  // Codecs this browser can decode (set on mount), and the other copies of the current version.
  const accept = useRef<string[]>(["mp3"]);
  const alternates = useRef<{ codec: string; url: string }[]>([]);
  const failedCodecs = useRef<Set<string>>(new Set());
  const currentCodec = useRef<string | null>(null);
  // Boost for quiet songs needs a Web Audio gain stage, which can only read media fetched in CORS
  // mode. `cors` says the element is in that mode; it is dropped for the visit if a load fails.
  const cors = useRef(false);
  // Set once media has played in CORS mode: later failures are then never blamed on CORS.
  const corsProven = useRef(false);
  const audioCtx = useRef<AudioContext | null>(null);
  const graph = useRef<{ gain: GainNode } | null>(null);
  const [routed, setRouted] = useState(false);
  const [corsSeen, setCorsSeen] = useState(false);
  const progress = useMemo(createProgressStore, []);
  const [volumeSettable, setVolumeSettable] = useState(true);
  const [state, setState] = useState<PlayerState>({
    track: null,
    status: "idle",
    problem: null,
    queue: [],
    index: 0,
    source: null,
    needsGesture: false,
    buffering: false,
    volume: 1,
    muted: false,
    repeat: "off",
    shuffle: false,
    normalise: true,
    gainDb: null,
    format: null,
  });
  const stateRef = useRef(state);
  stateRef.current = state;

  /** Called from a click or key press: browsers only let audio processing start from one. */
  const wakeAudio = useCallback(() => {
    if (!cors.current || !stateRef.current.normalise) return;
    try {
      const Ctor = window.AudioContext ?? (window as WebAudioWindow).webkitAudioContext;
      if (!audioCtx.current && Ctor) audioCtx.current = new Ctor();
      if (audioCtx.current?.state === "suspended") void audioCtx.current.resume().catch(() => undefined);
    } catch {
      /* no Web Audio here: levelling only turns loud songs down */
    }
  }, []);

  /** The playback copy to try, the codecs to ask for next time, and the format line. */
  const noteDelivery = useCallback((codec: string | null | undefined, kbps: number | null | undefined) => {
    currentCodec.current = codec ?? null;
    return formatLabel(codec, kbps);
  }, []);

  const report = useCallback((completed: boolean) => {
    const s = session.current;
    const a = audio.current;
    if (!s || !a || !s.track_id) return;
    const ms = listenedMs(a.currentTime, a.duration);
    if (ms <= 0) return;
    // A pause followed by a track change would otherwise report the same listen twice.
    if (lastReport.current?.session === s.id && lastReport.current.ms === ms && !completed) return;
    lastReport.current = { session: s.id, ms };
    const sent = ingestPlaybackEvent({ client_event_id: eventId(), track_id: s.track_id, session_id: s.id, duration_ms: ms, completed }).catch(() => undefined);
    inflight.current = Promise.all([inflight.current, sent]);
  }, []);

  const closeSession = useCallback(() => {
    const s = session.current;
    session.current = null;
    if (s && s.status === "OPEN") void inflight.current.then(() => closeListeningSession(s.id, s.version)).catch(() => undefined);
  }, []);

  const load = useCallback(
    async (meta: PlayerTrack, queue: PlayerTrack[], index: number, source: string | null) => {
      const a = audio.current;
      if (!a) return;
      const seq = ++loadSeq.current;
      report(false);
      a.pause();
      closeSession();
      // Drop the old source completely so it can never keep playing under the new track.
      a.removeAttribute("src");
      a.load();
      retried.current = false;
      alternates.current = [];
      failedCodecs.current = new Set();
      progress.set({ position: 0, duration: 0 });
      setState((s) => ({ ...s, track: meta, status: "loading", problem: null, queue, index, source, needsGesture: false, buffering: false, gainDb: null, format: null }));
      try {
        const [opened, row] = await Promise.all([
          openListeningSession(meta.id),
          meta.title ? Promise.resolve(null) : fetchTrack(meta.id).catch(() => null),
        ]);
        if (seq !== loadSeq.current) {
          if (opened.status === "OPEN") void closeListeningSession(opened.id, opened.version).catch(() => undefined);
          return;
        }
        session.current = opened;
        const track = row ? { ...meta, title: row.title } : meta;
        if (!opened.audio_deliverable) {
          setState((s) => ({ ...s, track, status: "problem", problem: { kind: "unavailable" } }));
          return;
        }
        const delivery = await fetchTrackAudio(meta.id, accept.current);
        if (seq !== loadSeq.current) return;
        alternates.current = [...(delivery.alternates ?? [])];
        const format = noteDelivery(delivery.codec, delivery.bitrate_kbps);
        a.src = resolveMediaUrl(delivery.url);
        setState((s) => ({ ...s, track, gainDb: delivery.gain_db ?? null, format }));
        try {
          await a.play();
        } catch (err) {
          if (seq !== loadSeq.current || isSuperseded(err)) return;
          if (isAutoplayBlocked(err)) {
            setState((s) => ({ ...s, status: "paused", needsGesture: true }));
            return;
          }
          // Media failures arrive as the element's error event, which retries once.
          if (a.error) return;
          throw err;
        }
      } catch (err) {
        if (seq !== loadSeq.current) return;
        setState((s) => ({ ...s, status: "problem", problem: playProblem(err) }));
      }
    },
    [closeSession, progress, report, noteDelivery],
  );

  const play = useCallback(
    async (input: PlayerTrack | string, options?: PlayOptions) => {
      const a = audio.current;
      if (!a) return;
      const meta: PlayerTrack = typeof input === "string" ? { id: input, title: "" } : input;
      const s = stateRef.current;
      // Without a list, a track already in Up next keeps that queue (a click in the corridor).
      const list = options?.queue ?? (s.queue.some((t) => t.id === meta.id) ? s.queue : undefined);
      const source = options?.queue ? (options.source ?? null) : list ? s.source : (options?.source ?? null);
      let { tracks, index } = queueFor(meta, list);
      // A new list while shuffle is on plays in shuffled order, starting from the chosen track.
      if (options?.queue) {
        original.current = s.shuffle ? tracks : null;
        if (s.shuffle && tracks.length > 1) {
          tracks = shuffled(tracks, index);
          index = 0;
        }
      }
      wakeAudio();
      if (s.track?.id === meta.id && (s.status === "paused" || s.status === "playing")) {
        if (options?.queue) setState((x) => ({ ...x, queue: tracks, index, source }));
        if (a.paused) await a.play().catch((err) => isAutoplayBlocked(err) && setState((x) => ({ ...x, needsGesture: true })));
        return;
      }
      await load(tracks[index], tracks, index, source);
    },
    [load, wakeAudio],
  );

  const toggle = useCallback(() => {
    const a = audio.current;
    const s = stateRef.current;
    if (!a || !s.track || s.status === "loading") return;
    wakeAudio();
    if (s.status === "problem") {
      void load(s.track, s.queue, s.index, s.source);
      return;
    }
    if (a.paused) void a.play().catch((err) => isAutoplayBlocked(err) && setState((x) => ({ ...x, needsGesture: true })));
    else a.pause();
  }, [load, wakeAudio]);

  const seek = useCallback(
    (seconds: number) => {
      const a = audio.current;
      const to = seekTarget(seconds, progress.get().duration);
      if (!a || to === null) return;
      a.currentTime = to;
      progress.set({ position: to });
    },
    [progress],
  );

  const next = useCallback(() => {
    const s = stateRef.current;
    const to = stepWithRepeat(s.index, s.queue.length, 1, s.repeat);
    if (to !== null) void load(s.queue[to], s.queue, to, s.source);
  }, [load]);

  const previous = useCallback(() => {
    const s = stateRef.current;
    if (!s.track) return;
    // On the first track: restart it, unless repeat-all wraps round to the last one.
    if (previousAction(s.index) === "restart" && !(s.repeat === "all" && s.queue.length > 1)) {
      seek(0);
      return;
    }
    const to = stepWithRepeat(s.index, s.queue.length, -1, s.repeat);
    if (to !== null) void load(s.queue[to], s.queue, to, s.source);
  }, [load, seek]);

  const savePrefs = useCallback((s: Pick<PlayerState, "shuffle" | "repeat" | "normalise">) => {
    writePrefs({ shuffle: s.shuffle, repeat: s.repeat, normalise: s.normalise });
  }, []);

  const toggleShuffle = useCallback(() => {
    const s = stateRef.current;
    if (!s.shuffle) {
      // On: the playing track stays first; the rest of the list follows in random order.
      original.current = s.queue;
      const reorder = s.queue.length > 1 && s.track !== null;
      const queue = reorder ? shuffled(s.queue, s.index) : s.queue;
      setState((x) => ({ ...x, shuffle: true, queue, index: reorder ? 0 : x.index }));
    } else {
      // Off: back to the list's own order, still on the same track.
      const list = original.current ?? s.queue;
      original.current = null;
      const at = s.track ? list.findIndex((t) => t.id === s.track?.id) : -1;
      setState((x) => ({ ...x, shuffle: false, queue: list, index: at >= 0 ? at : 0 }));
    }
    savePrefs({ ...s, shuffle: !s.shuffle });
  }, [savePrefs]);

  const cycleRepeat = useCallback(() => {
    const s = stateRef.current;
    const repeat = nextRepeat(s.repeat);
    setState((x) => ({ ...x, repeat }));
    savePrefs({ ...s, repeat });
  }, [savePrefs]);

  const toggleNormalise = useCallback(() => {
    const s = stateRef.current;
    const normalise = !s.normalise;
    setState((x) => ({ ...x, normalise }));
    savePrefs({ ...s, normalise });
    if (normalise) wakeAudio();
  }, [savePrefs, wakeAudio]);

  const setVolume = useCallback((volume: number) => {
    const v = Math.min(1, Math.max(0, volume));
    setState((s) => ({ ...s, volume: v, muted: v === 0 ? s.muted : false }));
    try {
      if (v > 0) window.localStorage.setItem(VOLUME_KEY, String(v));
    } catch {
      /* storage unavailable: volume still applies for this visit */
    }
  }, []);

  const toggleMute = useCallback(() => setState((s) => ({ ...s, muted: !s.muted })), []);

  /*
   * When the media fails, in order: (1) if it was fetched in CORS mode and nothing depends on that
   * yet, retry without it (boost is then off for this visit); (2) if this copy will not decode
   * here, try the next verified copy of the same version; (3) a signed URL lasts about five
   * minutes (Q-P8-01), so fetch a fresh one once, without the codecs that failed.
   */
  const onMediaError = useCallback(async () => {
    const a = audio.current;
    const s = stateRef.current;
    if (!a || !a.getAttribute("src")) return;
    const seq = loadSeq.current;
    const at = a.currentTime;
    const code = a.error?.code;
    const resume = async (url: string) => {
      a.src = url;
      a.currentTime = at;
      await a.play();
    };
    try {
      if (cors.current && !corsProven.current && !graph.current) {
        cors.current = false;
        a.removeAttribute("crossorigin");
        await resume(a.src);
        return;
      }
      if ((code === 3 || code === 4) && alternates.current.length > 0) {
        if (currentCodec.current) failedCodecs.current.add(currentCodec.current);
        const alt = alternates.current.shift()!;
        const format = noteDelivery(alt.codec, null);
        setState((x) => ({ ...x, format }));
        await resume(resolveMediaUrl(alt.url));
        return;
      }
      if (!s.track || retried.current) {
        setState((x) => (x.track ? { ...x, status: "problem", problem: { kind: "stopped" }, buffering: false } : x));
        return;
      }
      retried.current = true;
      const usable = accept.current.filter((c) => !failedCodecs.current.has(c));
      const delivery = await fetchTrackAudio(s.track.id, usable.length > 0 ? usable : accept.current);
      if (seq !== loadSeq.current) return;
      alternates.current = (delivery.alternates ?? []).filter((alt) => !failedCodecs.current.has(alt.codec));
      const format = noteDelivery(delivery.codec, delivery.bitrate_kbps);
      setState((x) => ({ ...x, format, gainDb: delivery.gain_db ?? x.gainDb }));
      await resume(resolveMediaUrl(delivery.url));
    } catch (err) {
      if (seq !== loadSeq.current || isSuperseded(err)) return;
      setState((x) => ({ ...x, status: "problem", problem: playProblem(err), buffering: false }));
    }
  }, [noteDelivery]);

  useEffect(() => () => closeSession(), [closeSession]);

  // Volume: remembered on this device; some devices (iOS) only allow the hardware buttons, and
  // there levelling is not offered either. Codec support and saved preferences are read here too.
  useEffect(() => {
    const probe = document.createElement("audio");
    probe.volume = 0.5;
    const settable = probe.volume === 0.5;
    setVolumeSettable(settable);
    accept.current = acceptCodecs((mime) => probe.canPlayType(mime));
    const hasWebAudio = typeof window.AudioContext !== "undefined" || typeof (window as WebAudioWindow).webkitAudioContext !== "undefined";
    // Boost needs readable media: ask for it in CORS mode before any source is set.
    if (settable && hasWebAudio && audio.current) {
      audio.current.crossOrigin = "anonymous";
      cors.current = true;
    }
    const prefs = readPrefs();
    setState((s) => ({ ...s, volume: readVolume(), ...prefs }));
  }, []);

  // Listener volume, mute and levelling, on the element or (once routed) on the gain stage.
  useEffect(() => {
    const a = audio.current;
    if (!a) return;
    const levels = outputLevels(state.volume, state.muted, levelMultiplier(state.gainDb, state.normalise), routed);
    a.volume = levels.element;
    a.muted = routed ? false : state.muted;
    if (graph.current) graph.current.gain.gain.value = levels.gain;
  }, [state.volume, state.muted, state.gainDb, state.normalise, routed]);

  // A quiet song needs a boost: route the element through a gain stage, once, and only after media
  // has played in CORS mode (so the stage can read it) with audio processing already running.
  useEffect(() => {
    if (state.status !== "playing" || graph.current || !cors.current || !corsProven.current) return;
    if (levelMultiplier(state.gainDb, state.normalise) <= 1) return;
    const a = audio.current;
    const c = audioCtx.current;
    if (!a || !c || c.state !== "running") return;
    try {
      const source = c.createMediaElementSource(a);
      const gain = c.createGain();
      source.connect(gain).connect(c.destination);
      graph.current = { gain };
      setRouted(true);
    } catch {
      /* routing refused: levelling keeps turning loud songs down only */
    }
  }, [state.status, state.gainDb, state.normalise, corsSeen]);

  const hasNext = stepWithRepeat(state.index, state.queue.length, 1, state.repeat) !== null;
  const api = useRef({ toggle, next, previous, seek, hasNext });
  api.current = { toggle, next, previous, seek, hasNext };

  // Media keys and the system's now-playing controls (music.md section 9).
  useEffect(() => {
    const ms = typeof navigator !== "undefined" ? navigator.mediaSession : undefined;
    if (!ms) return;
    const set = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
      try {
        ms.setActionHandler(action, handler);
      } catch {
        /* action not supported by this browser */
      }
    };
    set("play", () => audio.current?.paused && api.current.toggle());
    set("pause", () => audio.current && !audio.current.paused && api.current.toggle());
    set("previoustrack", () => api.current.previous());
    set("seekto", (d) => typeof d.seekTime === "number" && api.current.seek(d.seekTime));
    set("seekbackward", (d) => api.current.seek(progress.get().position - (d.seekOffset ?? 10)));
    set("seekforward", (d) => api.current.seek(progress.get().position + (d.seekOffset ?? 10)));
    return () => {
      for (const a of ["play", "pause", "previoustrack", "nexttrack", "seekto", "seekbackward", "seekforward"] as MediaSessionAction[]) set(a, null);
    };
  }, [progress]);
  useEffect(() => {
    const ms = typeof navigator !== "undefined" ? navigator.mediaSession : undefined;
    if (!ms) return;
    try {
      ms.setActionHandler("nexttrack", hasNext ? () => api.current.next() : null);
    } catch {
      /* not supported */
    }
  }, [hasNext]);
  useEffect(() => {
    const ms = typeof navigator !== "undefined" ? navigator.mediaSession : undefined;
    if (!ms || typeof MediaMetadata === "undefined") return;
    ms.metadata = state.track
      ? new MediaMetadata({ title: state.track.title || "Track", artist: state.track.artist ?? "", album: state.source ?? "" })
      : null;
  }, [state.track, state.source]);
  useEffect(() => {
    const ms = typeof navigator !== "undefined" ? navigator.mediaSession : undefined;
    if (ms) ms.playbackState = state.status === "playing" ? "playing" : state.track ? "paused" : "none";
  }, [state.status, state.track]);

  const syncPosition = (a: HTMLAudioElement) => {
    progress.set({ position: a.currentTime });
    const ms = navigator.mediaSession;
    if (ms?.setPositionState && Number.isFinite(a.duration) && a.duration > 0) {
      try {
        ms.setPositionState({ duration: a.duration, position: Math.min(a.currentTime, a.duration), playbackRate: a.playbackRate });
      } catch {
        /* inconsistent values during a source change */
      }
    }
  };

  const value = useMemo<PlayerApi>(
    () => ({
      ...state,
      hasNext,
      volumeSettable,
      progress,
      play,
      toggle,
      seek,
      next,
      previous,
      setVolume,
      toggleMute,
      toggleShuffle,
      cycleRepeat,
      toggleNormalise,
      levellingAvailable: volumeSettable,
      isCurrent: (id) => state.track?.id === id,
    }),
    [state, hasNext, volumeSettable, progress, play, toggle, seek, next, previous, setVolume, toggleMute, toggleShuffle, cycleRepeat, toggleNormalise],
  );

  return (
    <PlayerContext.Provider value={value}>
      {children}
      <audio
        ref={audio}
        preload="none"
        onPlay={() => {
          setState((s) => ({ ...s, status: "playing", problem: null, needsGesture: false }));
          if (audioCtx.current?.state === "suspended") void audioCtx.current.resume().catch(() => undefined);
        }}
        onPlaying={() => {
          // Audio is flowing again: a later expiry of this song's signed link (they last about five
          // minutes, Q-P8-01; songs may run 60) may be refreshed once more. A fresh link that fails
          // at once never reaches here, so this cannot loop.
          retried.current = false;
          if (cors.current && !corsProven.current) {
            corsProven.current = true;
            setCorsSeen(true);
          }
          setState((s) => (s.buffering ? { ...s, buffering: false } : s));
        }}
        onWaiting={() => setState((s) => (s.status === "playing" && !s.buffering ? { ...s, buffering: true } : s))}
        onPause={() => {
          setState((s) => (s.status === "playing" ? { ...s, status: "paused", buffering: false } : s));
          report(false);
        }}
        onEnded={() => {
          report(true);
          const s = stateRef.current;
          const step = afterEnd(s.index, s.queue.length, s.repeat);
          // Each play, a repeat included, is its own listening session and listen.
          if (step.kind === "go") {
            void load(s.queue[step.index], s.queue, step.index, s.source);
            return;
          }
          if (step.kind === "replay" && s.track) {
            void load(s.track, s.queue, s.index, s.source);
            return;
          }
          progress.set({ position: 0 });
          setState((x) => ({ ...x, status: "paused", buffering: false }));
        }}
        onTimeUpdate={(e) => syncPosition(e.currentTarget)}
        onSeeked={(e) => syncPosition(e.currentTarget)}
        onDurationChange={(e) => {
          const d = e.currentTarget.duration;
          progress.set({ duration: Number.isFinite(d) && d > 0 ? d : 0 });
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

/** Position and duration as the audio element reports them. Re-renders only its caller. */
export function usePlayerProgress(): PlayerProgress {
  const { progress } = usePlayer();
  return useSyncExternalStore(progress.subscribe, progress.get, progress.get);
}

/** What the listener is told about the current state, in words (never colour alone). */
export function playerStatusText(p: Pick<PlayerApi, "status" | "problem" | "needsGesture" | "buffering">): string {
  if (p.status === "problem" && p.problem) return problemMessage(p.problem);
  if (p.status === "loading") return "Loading";
  if (p.needsGesture) return "Press play to start";
  if (p.buffering) return "Buffering";
  if (p.status === "playing") return "Playing";
  if (p.status === "paused") return "Paused";
  return "";
}

/** Shuffle on or off; the state is in the name and aria-pressed, and the icon is lit when on. */
export function ShuffleButton({ className }: { className?: string }) {
  const p = usePlayer();
  return (
    <button
      type="button"
      onClick={p.toggleShuffle}
      aria-pressed={p.shuffle}
      aria-label={p.shuffle ? "Shuffle: on" : "Shuffle: off"}
      title={p.shuffle ? "Shuffle on" : "Shuffle off"}
      className={cn(
        "cr-focus relative inline-flex size-10 items-center justify-center hover:text-fg",
        p.shuffle ? "text-highlight" : "text-fg-muted",
        className,
      )}
    >
      <Shuffle aria-hidden="true" className="size-4" />
      {p.shuffle ? <span aria-hidden="true" className="absolute bottom-1.5 size-1 rounded-full bg-current" /> : null}
    </button>
  );
}

/** Repeat off, all, or this track; one button cycles through them and says which is on. */
export function RepeatButton({ className }: { className?: string }) {
  const p = usePlayer();
  const on = p.repeat !== "off";
  return (
    <button
      type="button"
      onClick={p.cycleRepeat}
      aria-label={repeatLabel(p.repeat)}
      title={repeatLabel(p.repeat)}
      className={cn("cr-focus relative inline-flex size-10 items-center justify-center hover:text-fg", on ? "text-highlight" : "text-fg-muted", className)}
    >
      {p.repeat === "one" ? <Repeat1 aria-hidden="true" className="size-4" /> : <Repeat aria-hidden="true" className="size-4" />}
      {on ? <span aria-hidden="true" className="absolute bottom-1.5 size-1 rounded-full bg-current" /> : null}
    </button>
  );
}

/** The listening room draws its own controls and its own screen: the bar and shell step aside. */
export function isRoomPath(pathname: string | null): boolean {
  return Boolean(pathname && /^\/listen\/[^/]+$/.test(pathname));
}

function BarProgress({ label }: { label: string }) {
  const p = usePlayer();
  const { position, duration } = usePlayerProgress();
  return (
    <div className="hidden min-w-0 flex-1 items-center gap-3 sm:flex">
      <span className="cr-num w-10 text-right text-xs text-fg-muted">{clock(position)}</span>
      <input
        type="range"
        min={0}
        max={Math.max(1, Math.floor(duration || 0))}
        step={5}
        value={Math.floor(position)}
        disabled={duration <= 0}
        onChange={(e) => p.seek(Number(e.target.value))}
        aria-label={`Seek in ${label}`}
        aria-valuetext={`${clock(position)} of ${durationLabel(duration)}`}
        className={cn("cr-focus h-1 min-w-0 flex-1 cursor-pointer accent-[var(--cr-highlight)] disabled:cursor-default")}
      />
      <span className="cr-num w-10 text-xs text-fg-muted">{durationLabel(duration)}</span>
    </div>
  );
}

/**
 * Fixed player bar: glass over the Sky world, front-only cube, title and artist, previous, play
 * or pause, next, a labelled scrubber with 5 s keyboard steps, elapsed and total, and the way into
 * the listening room. Sits above the phone tab bar; hidden inside the room, which has its own.
 */
export function PlayerBar() {
  const p = usePlayer();
  const pathname = usePathname();
  if (!p.track || isRoomPath(pathname)) return null;
  const playing = p.status === "playing";
  const label = p.track.title || "Track";
  const status = playerStatusText(p);
  return (
    <>
      <div className="h-20" aria-hidden="true" />
      <section
        aria-label="Player"
        data-theme="sky"
        className="cr-scope fixed inset-x-0 bottom-16 z-40 border-t border-cr-sky/60 lg:bottom-0"
      >
        <div className="cr-glass mx-auto flex h-20 max-w-[90rem] items-center gap-3 px-3 md:gap-5 md:px-6">
          <Link href={`/listen/${p.track.id}`} aria-label={`Open the listening room for ${label}`} className="cr-focus size-12 shrink-0 bg-cr-sky">
            <CoverArt
              src={coverUrl({ track: p.track.id }, 160)}
              fallback={<RoomCube front={label} side={p.track.artist || label} tone="sky" size="front" label="" className="size-full" />}
              className="size-full"
            />
          </Link>
          <div className="min-w-0 flex-1 md:flex-none md:basis-56">
            <p className="truncate text-sm font-bold text-fg">{label}</p>
            <p className="truncate text-xs text-fg-muted">
              {p.status === "playing" && !p.buffering ? (p.track.artist ?? "") : status}
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
              <div className="flex shrink-0 items-center gap-1">
                <ShuffleButton className="hidden lg:inline-flex" />
                <button
                  type="button"
                  onClick={p.previous}
                  aria-label="Previous track"
                  className="cr-focus hidden size-10 items-center justify-center text-fg-muted hover:text-fg md:inline-flex"
                >
                  <SkipBack aria-hidden="true" className="size-4" />
                </button>
                <button
                  type="button"
                  onClick={p.toggle}
                  disabled={p.status === "loading"}
                  aria-label={playing ? `Pause ${label}` : `Play ${label}`}
                  className="cr-focus inline-flex size-11 shrink-0 items-center justify-center bg-accent text-on-accent disabled:opacity-50"
                >
                  {playing ? <Pause aria-hidden="true" className="size-5" /> : <Play aria-hidden="true" className="size-5" />}
                </button>
                {p.hasNext ? (
                  <button
                    type="button"
                    onClick={p.next}
                    aria-label="Next track"
                    className="cr-focus inline-flex size-10 items-center justify-center text-fg-muted hover:text-fg"
                  >
                    <SkipForward aria-hidden="true" className="size-4" />
                  </button>
                ) : null}
                <RepeatButton className="hidden lg:inline-flex" />
              </div>
              <BarProgress label={label} />
              <Link
                href={`/listen/${p.track.id}`}
                className="cr-focus hidden items-center gap-1.5 text-xs font-semibold text-link hover:underline md:inline-flex"
              >
                <Maximize2 aria-hidden="true" className="size-3.5" /> Listening room
              </Link>
            </>
          )}
        </div>
      </section>
    </>
  );
}
