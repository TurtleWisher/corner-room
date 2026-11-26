"use client";

/*
 * The closing story's motion (owner, 2026-11-26): one scroll listener for the whole end of the home
 * page. Scrolling decides what should show; each movement then plays through on its own clock to its
 * finished frame (owner, 2026-11-27: stopping mid-scroll must never leave a block half-arrived). A
 * block comes in once its top rises into the window and goes back only when it drops out at the
 * bottom edge (scrolling up); the prism turns all the way to the face for where the reader is. The
 * values are written as CSS variables (--k, --turn, --lit, --door); the styles in
 * app/styles/modules/home-story.css turn them into transforms and opacity. React never re-renders.
 *
 * Nothing moves by itself: the loop runs only while a movement that scrolling, a resize or a pointer
 * move started is still playing. Without JavaScript, under reduced motion, or before this runs, every
 * block is simply shown as it is (data-story is set only once the engine is live).
 *
 * Hooks in the markup:
 *   [data-k]              comes in once on screen (--k 0 to 1, timed); data-k-lag delays its start
 *                         a little (lag x 2 s), so rows arrive one after another.
 *   [data-door]           also gets --door, the closing door's swing in degrees.
 *   [data-prism-scene]    a pinned scene whose [data-face] children turn as a prism (wide screens).
 *   [data-face-go="i"]    a button that brings face i to the front.
 *   [data-tilt]           leans toward a fine pointer (--rx, --ry).
 */

import * as React from "react";

import {
  ENTER_MS,
  LEAVE_MS,
  TURN_MS,
  doorAngle,
  easeInOutCubic,
  faceFor,
  faceLight,
  frontFace,
  leanToward,
  sceneProgress,
  scrollForFace,
  shouldShow,
  tween,
} from "@/lib/home-story-view";

/** One block's entrance: whether it is shown, and the timed move toward that. */
type Entrance = { shown: boolean; from: number; to: number; start: number; dur: number; value: number };
/** The prism's turn: which face it is going to, and the timed move there. */
type Turn = { face: number; from: number; start: number; value: number };

/** Wide enough, and tall enough, for the pinned prism; smaller screens get the cards stacked. */
const PRISM_QUERY = "(min-width: 900px) and (min-height: 600px)";

export function StoryEnd({ children, className }: { children: React.ReactNode; className?: string }) {
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const root = ref.current;
    if (!root || typeof window.matchMedia !== "function") return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const wide = window.matchMedia(PRISM_QUERY);

    const blocks = Array.from(root.querySelectorAll<HTMLElement>("[data-k]"));
    const scenes = Array.from(root.querySelectorAll<HTMLElement>("[data-prism-scene]"));
    const kNow = new Map<HTMLElement, Entrance>();
    const turnNow = new Map<HTMLElement, Turn>();
    let raf = 0;
    let destroyed = false;

    const prismOn = () => !reduced && wide.matches;

    function frame() {
      raf = 0;
      if (destroyed) return;
      const now = performance.now();
      const vh = window.innerHeight;
      // At the very end of the page everything has arrived, however short the space below it.
      const atEnd = window.scrollY + vh >= document.documentElement.scrollHeight - 2;
      let moving = false;

      for (const el of blocks) {
        const st = kNow.get(el) ?? { shown: false, from: 0, to: 0, start: now, dur: 0, value: 0 };
        const shown = atEnd || shouldShow(el.getBoundingClientRect().top, vh, st.shown);
        if (shown !== st.shown || !kNow.has(el)) {
          // Start from wherever it is now, so turning back mid-way never jumps.
          const lagMs = shown ? (Number(el.dataset.kLag) || 0) * 2000 : 0;
          Object.assign(st, { shown, from: st.value, to: shown ? 1 : 0, start: now + lagMs, dur: shown ? ENTER_MS : LEAVE_MS });
          kNow.set(el, st);
        }
        const value = tween(st.from, st.to, now - st.start, st.dur);
        if (value !== st.to) moving = true;
        if (value === st.value && el.style.getPropertyValue("--k")) continue;
        st.value = value;
        el.style.setProperty("--k", value.toFixed(4));
        if (el.dataset.door !== undefined) el.style.setProperty("--door", `${doorAngle(value).toFixed(2)}deg`);
      }

      if (prismOn()) {
        for (const scene of scenes) {
          const faces = Array.from(scene.querySelectorAll<HTMLElement>("[data-face]"));
          const n = faces.length;
          const r = scene.getBoundingClientRect();
          const face = faceFor(sceneProgress(r.top, r.height, vh), n);
          let st = turnNow.get(scene);
          if (!st) {
            st = { face, from: face, start: now, value: face };
            turnNow.set(scene, st);
          } else if (face !== st.face) {
            Object.assign(st, { face, from: st.value, start: now });
          }
          // A longer way round (two faces at once) takes a little longer.
          const dur = TURN_MS * Math.min(1.6, Math.max(1, Math.abs(st.face - st.from)));
          const value = tween(st.from, st.face, now - st.start, dur, easeInOutCubic);
          if (value !== st.face) moving = true;
          if (value === st.value && scene.style.getPropertyValue("--turn")) continue;
          st.value = value;
          scene.style.setProperty("--turn", value.toFixed(4));
          const front = frontFace(value, n);
          if (scene.dataset.front !== String(front)) {
            scene.dataset.front = String(front);
            faces.forEach((f, i) => (i === front ? (f.dataset.front = "") : delete f.dataset.front));
          }
          scene.querySelectorAll<HTMLElement>("[data-face-go]").forEach((b) => b.setAttribute("aria-current", b.dataset.faceGo === String(st.face) ? "true" : "false"));
          faces.forEach((f, i) => f.style.setProperty("--lit", faceLight(i, value, n).toFixed(3)));
        }
      }

      if (moving) raf = requestAnimationFrame(frame);
    }
    const schedule = () => {
      if (!raf && !destroyed) raf = requestAnimationFrame(frame);
    };

    const setPrism = () => {
      if (prismOn()) root.dataset.prism = "";
      else {
        delete root.dataset.prism;
        turnNow.clear();
      }
      schedule();
    };

    // Bring a face to the front: scroll to where the scene shows it.
    const goTo = (scene: HTMLElement, i: number) => {
      const n = scene.querySelectorAll("[data-face]").length;
      const r = scene.getBoundingClientRect();
      window.scrollTo({ top: scrollForFace(i, n, r.top + window.scrollY, r.height, window.innerHeight), behavior: reduced ? "auto" : "smooth" });
    };
    const onClick = (e: MouseEvent) => {
      const go = (e.target as HTMLElement | null)?.closest<HTMLElement>("[data-face-go]");
      const scene = go?.closest<HTMLElement>("[data-prism-scene]");
      if (!go || !scene || !prismOn()) return;
      e.preventDefault();
      goTo(scene, Number(go.dataset.faceGo));
    };
    // Tabbing onto a face that is turned away turns the prism to it first.
    const onFocusIn = (e: FocusEvent) => {
      if (!prismOn()) return;
      const face = (e.target as HTMLElement | null)?.closest<HTMLElement>("[data-face]");
      const scene = face?.closest<HTMLElement>("[data-prism-scene]");
      if (!face || !scene || face.dataset.front !== undefined) return;
      const faces = Array.from(scene.querySelectorAll<HTMLElement>("[data-face]"));
      goTo(scene, faces.indexOf(face));
    };

    // Cards that lean toward a fine pointer.
    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || reduced) return;
      const card = (e.target as HTMLElement | null)?.closest<HTMLElement>("[data-tilt]");
      if (!card) return;
      const r = card.getBoundingClientRect();
      const { rx, ry } = leanToward(((e.clientX - r.left) / r.width) * 2 - 1, ((e.clientY - r.top) / r.height) * 2 - 1, Number(card.dataset.tilt) || 5);
      card.style.setProperty("--rx", `${rx.toFixed(2)}deg`);
      card.style.setProperty("--ry", `${ry.toFixed(2)}deg`);
      card.dataset.tilting = "";
    };
    const onPointerOut = (e: PointerEvent) => {
      const card = (e.target as HTMLElement | null)?.closest<HTMLElement>("[data-tilt]");
      if (!card || card.contains(e.relatedTarget as Node | null)) return;
      card.style.setProperty("--rx", "0deg");
      card.style.setProperty("--ry", "0deg");
      delete card.dataset.tilting;
    };

    root.addEventListener("click", onClick);
    root.addEventListener("focusin", onFocusIn);
    if (reduced) {
      // Still: everything shown, the faces stacked, nothing leaning.
      root.dataset.story = "still";
      return () => {
        destroyed = true;
        root.removeEventListener("click", onClick);
        root.removeEventListener("focusin", onFocusIn);
        delete root.dataset.story;
      };
    }

    root.addEventListener("pointermove", onPointerMove);
    root.addEventListener("pointerout", onPointerOut);
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    wide.addEventListener?.("change", setPrism);
    setPrism();
    // Measure once before the styles switch on; blocks already on screen then play in.
    frame();
    root.dataset.story = "live";

    return () => {
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      root.removeEventListener("click", onClick);
      root.removeEventListener("focusin", onFocusIn);
      root.removeEventListener("pointermove", onPointerMove);
      root.removeEventListener("pointerout", onPointerOut);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      wide.removeEventListener?.("change", setPrism);
      delete root.dataset.story;
      delete root.dataset.prism;
    };
  }, []);

  return (
    <div ref={ref} className={className ? `home-story ${className}` : "home-story"}>
      {children}
    </div>
  );
}
