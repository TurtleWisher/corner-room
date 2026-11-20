"use client";

import { useId, useState } from "react";
import { MicVocal } from "lucide-react";

import type { LyricsSwitch } from "@/lib/room-controls-view";

/**
 * The room's lyrics toggle (owner, 2026-11-06, D-ROOM-05; made minimal 2026-11-21): one lyrics
 * icon, no words. On, the icon is lit in Sky; off, a slash draws across it. Still a real switch
 * (role="switch", aria-checked) whose name and title say what it does, so it never relies on colour
 * alone. It drives the same lyrics state as the small lyrics button in the player bar. The first
 * time it can be used in a visit it pulses gently, twice (never under reduced motion).
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
        aria-label="Lyrics"
        aria-describedby={ready ? undefined : reasonId}
        disabled={!ready}
        onClick={onToggle}
        onAnimationEnd={(e) => {
          if (e.animationName === "lr-invite") setInvite(false);
        }}
        title={ready ? state.title : state.reason}
        data-invite={invite && ready ? "" : undefined}
        className="lr-lyrics-switch lr-chip lr-chip-icon cr-cut cr-cut-sm cr-focus"
      >
        <span aria-hidden="true" className="lr-lyrics-icon">
          <MicVocal className="size-[1.1rem]" />
          <span className="lr-lyrics-slash" />
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
