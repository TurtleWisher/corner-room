export type PlayerStatus = "idle" | "playing" | "paused" | "ended";

export type PlayerState = {
  status: PlayerStatus;
  positionMs: number;
  durationMs: number;
  trackId: string | null;
  trackVersionId: string | null;
};

export type PlayerCommand =
  | { type: "load"; trackId: string; trackVersionId: string | null; durationMs: number }
  | { type: "play" }
  | { type: "pause" }
  | { type: "seek"; positionMs: number }
  | { type: "tick"; positionMs: number }
  | { type: "ended" };

export function initialPlayerState(): PlayerState {
  return {
    status: "idle",
    positionMs: 0,
    durationMs: 0,
    trackId: null,
    trackVersionId: null,
  };
}

function clamp(positionMs: number, durationMs: number): number {
  if (durationMs <= 0) {
    return 0;
  }
  return Math.min(Math.max(0, positionMs), durationMs);
}

export function applyPlayerCommand(state: PlayerState, command: PlayerCommand): PlayerState {
  switch (command.type) {
    case "load":
      return {
        status: "paused",
        positionMs: 0,
        durationMs: Math.max(0, command.durationMs),
        trackId: command.trackId,
        trackVersionId: command.trackVersionId,
      };
    case "play":
      if (!state.trackId) {
        return state;
      }
      return { ...state, status: "playing" };
    case "pause":
      if (state.status !== "playing") {
        return state;
      }
      return { ...state, status: "paused" };
    case "seek":
      return { ...state, positionMs: clamp(command.positionMs, state.durationMs) };
    case "tick":
      if (state.status !== "playing") {
        return state;
      }
      return { ...state, positionMs: clamp(command.positionMs, state.durationMs) };
    case "ended":
      return { ...state, status: "ended", positionMs: state.durationMs };
    default:
      return state;
  }
}

export function progressRatio(state: PlayerState): number {
  if (state.durationMs <= 0) {
    return 0;
  }
  return state.positionMs / state.durationMs;
}
