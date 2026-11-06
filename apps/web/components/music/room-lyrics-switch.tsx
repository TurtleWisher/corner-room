"use client";

import { useId, useState } from "react";
import { MicVocal } from "lucide-react";

import type { LyricsSwitch } from "@/lib/room-controls-view";

/**
 * The lyrics switch under the room's close button (owner, 2026-11-06, D-ROOM-05). A real switch
 * (role="switch", aria-checked) with the state in words beside it, so it never relies on colour.
 * It drives the same lyrics state as the small lyrics button in the player bar. The first time it
 * can be used in a visit it pulses gently, twice, to be noticed (never under reduced motion).
 */
export function RoomLyricsSwitch({ state, onToggle }: { state: LyricsSwitch; onToggle: () => void }) {
  const reasonId = useId();
  // The one-time invitation: dropped when its animation ends, so it never plays again this visit.
  const [invite, setInvite] = useState(true);
  if (state.kind === "hidden") return null;
  const ready = state.kind === "ready";
  const checked = ready && state.checked;
  return (
    <div className="lr-lyrics-control">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-describedby={ready ? undefined : reasonId}
        disabled={!ready}
        onClick={onToggle}
        onAnimationEnd={(e) => {
          if (e.animationName === "lr-invite") setInvite(false);
        }}
        title={ready ? state.title : undefined}
        data-invite={invite && ready ? "" : undefined}
        className="lr-lyrics-switch lr-chip cr-cut cr-cut-sm cr-focus"
      >
        <MicVocal aria-hidden="true" className="size-4" />
        <span>Lyrics</span>
        <span aria-hidden="true" className="lr-switch-track">
          <span className="lr-switch-thumb" />
        </span>
        <span aria-hidden="true" className="lr-switch-state">
          {ready ? state.stateText : "None"}
        </span>
      </button>
      {ready ? null : (
        <p id={reasonId} className="lr-lyrics-reason">
          {state.reason}
        </p>
      )}
    </div>
  );
}
