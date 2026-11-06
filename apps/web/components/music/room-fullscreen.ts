"use client";

import { useCallback, useEffect, useRef } from "react";

import { isRoomGestureKey, shouldAskFullscreen } from "@/lib/room-controls-view";

/** Elements whose activation leaves the room: asking for full screen on the way out would flash. */
const LEAVES_ROOM = "a[href], [data-room-leave]";
/** Fields a key press types into (the room's sliders are not typing). */
const TYPING = 'input:not([type="range"]), textarea, select, [contenteditable="true"]';

function fullscreenSupported(): boolean {
  return (
    typeof document !== "undefined" &&
    document.fullscreenEnabled === true &&
    typeof document.documentElement.requestFullscreen === "function"
  );
}

function alreadyFullscreen(): boolean {
  if (document.fullscreenElement) return true;
  // The browser's own full screen (F11) is not an element; the display mode still says so.
  return typeof window.matchMedia === "function" && window.matchMedia("(display-mode: fullscreen)").matches;
}

function closest(target: EventTarget | null, selector: string): boolean {
  return target instanceof Element && target.closest(selector) !== null;
}

/**
 * Real browser full screen for the listening room (owner, 2026-11-06, D-ROOM-05). Browsers allow
 * it only after a user gesture, so the room is drawn edge to edge in the page from the start, and
 * the listener's first click or deliberate key press in the room asks the browser once. A refusal
 * is quiet. Escape (the browser's own) leaves full screen and the room stays; leaving the room
 * ends the full screen the room started.
 */
export function useRoomFullscreen() {
  const asked = useRef(false);
  const entered = useRef(false);

  const ask = useCallback((target: EventTarget | null, typing: boolean) => {
    const supported = fullscreenSupported();
    const go = shouldAskFullscreen({
      asked: asked.current,
      supported,
      alreadyFullscreen: supported && alreadyFullscreen(),
      leavesRoom: closest(target, LEAVES_ROOM),
      typing,
    });
    if (!go) return;
    asked.current = true;
    try {
      document.documentElement
        .requestFullscreen({ navigationUI: "hide" })
        .then(() => {
          entered.current = true;
        })
        .catch(() => {
          // Refused (or a frame without permission): the in-page room is already full window.
        });
    } catch {
      // Older engines throw instead of rejecting; same quiet fallback.
    }
  }, []);

  useEffect(
    () => () => {
      if (!entered.current || !document.fullscreenElement) return;
      document.exitFullscreen().catch(() => {});
    },
    [],
  );

  const onClickCapture = useCallback((e: React.MouseEvent) => ask(e.target, false), [ask]);
  const onKeyDownCapture = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || !isRoomGestureKey(e.key)) return;
      ask(e.target, closest(e.target, TYPING));
    },
    [ask],
  );
  return { onClickCapture, onKeyDownCapture };
}
