"use client";

import { useCallback, useEffect, useRef } from "react";

import { doubleClickFullscreen, ROOM_CONTROLS } from "@/lib/room-controls-view";

function fullscreenSupported(): boolean {
  return (
    typeof document !== "undefined" &&
    document.fullscreenEnabled === true &&
    typeof document.documentElement.requestFullscreen === "function"
  );
}

/** The browser's own full screen (F11) is not an element; the display mode still says so. */
function browserFullscreen(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(display-mode: fullscreen)").matches;
}

/**
 * Real browser full screen for the listening room (owner, 2026-11-07, D-ROOM-05), like a video
 * site: a double-click (or double-tap) on empty space in the room goes into full screen, and the
 * same again comes out. Buttons, the bar and the covers never do it, and a single click never asks.
 * The browser's own ✕ at the top of the screen and Escape also leave full screen, and leaving the
 * room ends the full screen it started. A refusal is quiet: the room already fills the window.
 */
export function useRoomFullscreen() {
  const entered = useRef(false);

  useEffect(() => {
    const onChange = () => {
      if (!document.fullscreenElement) entered.current = false;
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      if (entered.current && document.fullscreenElement) document.exitFullscreen().catch(() => {});
    };
  }, []);

  const onDoubleClick = useCallback((e: React.MouseEvent) => {
    const target = e.target;
    const move = doubleClickFullscreen({
      supported: fullscreenSupported(),
      onControl: target instanceof Element && target.closest(ROOM_CONTROLS) !== null,
      pageFullscreen: Boolean(document.fullscreenElement),
      browserFullscreen: browserFullscreen(),
    });
    if (!move) return;
    // A double-click also selects the word under it; that isn't what the listener meant.
    window.getSelection?.()?.removeAllRanges();
    try {
      if (move === "exit") {
        document.exitFullscreen().catch(() => {});
        return;
      }
      document.documentElement
        .requestFullscreen({ navigationUI: "hide" })
        .then(() => {
          entered.current = true;
        })
        .catch(() => {});
    } catch {
      // Older engines throw instead of rejecting; same quiet fallback.
    }
  }, []);

  return { onDoubleClick };
}
