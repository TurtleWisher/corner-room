"use client";

/*
 * The closing story's motion (owner, 2026-11-26): one scroll listener for the whole end of the home
 * page. Follow, then settle (owner, 2026-11-27): while the reader scrolls, every movement follows the
 * scroll position, forward and back, at the reader's own speed; once they stop (IDLE_MS without a
 * scroll), whatever is part-way finishes by itself (blocks on screen to their finished frame, the
 * prism's turn to the next face in the way they were going). Scrolling on picks up from there with
 * no jump (followTarget). The values are written as CSS variables (--k, --turn, --lit, --door); the
 * styles in app/styles/modules/home-story.css turn them into transforms and opacity. React never
 * re-renders.
 *
 * Nothing moves by itself: the loop runs only while the reader scrolls and while what that started
 * is still settling. Without JavaScript, under reduced motion, or before this runs, every
 * block is simply shown as it is (data-story is set only once the engine is live).
 *
 * Hooks in the markup:
 *   [data-k]              comes in with the scroll (--k 0 to 1); data-k-lag starts it a little later
 *                         (a fraction of the window), so rows arrive one after another.
 *   [data-door]           also gets --door, the closing door's swing in degrees.
 *   [data-prism-scene]    a pinned scene whose [data-face] children turn as a prism (wide screens).
 *   [data-face-go="i"]    a button that brings face i to the front.
 *   [data-tilt]           leans toward a fine pointer (--rx, --ry).
 */

import * as React from "react";

import {
  FOLLOW_RATE,
  IDLE_MS,
  SETTLE_RATE,
  TURN_SETTLE_RATE,
  doorAngle,
  enterProgress,
  faceLight,
  followTarget,
  frontFace,
  glide,
  leanToward,
  prismTurn,
  sceneProgress,
  scrollForFace,
  settleFace,
  settleK,
} from "@/lib/home-story-view";

/** A moving value: where it is now, and what it settled on when the reader last stopped. */
type Motion = { value: number; held: number | null };

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
    const kNow = new Map<HTMLElement, Motion>();
    const turnNow = new Map<HTMLElement, Motion>();
    let raf = 0;
    let last = 0;
    // When the reader last scrolled, and which way (1 down, -1 up).
    let scrolledAt = -Infinity;
    let direction = 1;
    let lastY = window.scrollY;
    let destroyed = false;

    const prismOn = () => !reduced && wide.matches;

    function frame(t: number) {
      raf = 0;
      if (destroyed) return;
      const dt = last ? Math.min((t - last) / 1000, 0.1) : 1 / 60;
      last = t;
      const now = performance.now();
      const vh = window.innerHeight;
      const scrolling = now - scrolledAt < IDLE_MS;
      // At the very end of the page everything has arrived, however short the space below it.
      const atEnd = window.scrollY + vh >= document.documentElement.scrollHeight - 2;
      // Keep looking while the reader scrolls, so the moment they stop is noticed and things settle.
      let moving = scrolling;

      for (const el of blocks) {
        const top = el.getBoundingClientRect().top;
        let st = kNow.get(el);
        const scrub = atEnd ? 1 : enterProgress(top + (Number(el.dataset.kLag) || 0) * vh, vh);
        let target: number;
        if (!st) {
          st = { value: scrub, held: null };
          kNow.set(el, st);
          target = scrub;
        } else if (scrolling) {
          const f = followTarget(scrub, st.held, direction);
          st.held = f.held;
          target = f.target;
        } else {
          // Stopped: anything on screen finishes; only what is below the fold empties.
          target = atEnd ? 1 : settleK(top, vh);
          st.held = target;
        }
        const next = glide(st.value, target, dt, scrolling ? FOLLOW_RATE : SETTLE_RATE);
        if (next !== target) moving = true;
        if (next === st.value && el.style.getPropertyValue("--k")) continue;
        st.value = next;
        el.style.setProperty("--k", next.toFixed(4));
        if (el.dataset.door !== undefined) el.style.setProperty("--door", `${doorAngle(next).toFixed(2)}deg`);
      }

      if (prismOn()) {
        for (const scene of scenes) {
          const faces = Array.from(scene.querySelectorAll<HTMLElement>("[data-face]"));
          const n = faces.length;
          const r = scene.getBoundingClientRect();
          const scrub = prismTurn(sceneProgress(r.top, r.height, vh), n);
          let st = turnNow.get(scene);
          let target: number;
          if (!st) {
            st = { value: scrub, held: null };
            turnNow.set(scene, st);
            target = scrub;
          } else if (scrolling) {
            const f = followTarget(scrub, st.held, direction);
            st.held = f.held;
            target = f.target;
          } else {
            // Stopped part-way through a turn: finish it, in the way the reader was going.
            if (st.held === null) st.held = settleFace(scrub, direction, n);
            target = st.held;
          }
          const next = glide(st.value, target, dt, scrolling ? FOLLOW_RATE : TURN_SETTLE_RATE);
          if (next !== target) moving = true;
          const rail = String(frontFace(target, n));
          scene.querySelectorAll<HTMLElement>("[data-face-go]").forEach((b) => b.setAttribute("aria-current", b.dataset.faceGo === rail ? "true" : "false"));
          if (next === st.value && scene.style.getPropertyValue("--turn")) continue;
          st.value = next;
          scene.style.setProperty("--turn", next.toFixed(4));
          const front = frontFace(next, n);
          if (scene.dataset.front !== String(front)) {
            scene.dataset.front = String(front);
            faces.forEach((f, i) => (i === front ? (f.dataset.front = "") : delete f.dataset.front));
          }
          faces.forEach((f, i) => f.style.setProperty("--lit", faceLight(i, next, n).toFixed(3)));
        }
      }

      if (moving) raf = requestAnimationFrame(frame);
      else last = 0;
    }
    const onScroll = () => {
      const y = window.scrollY;
      if (y !== lastY) direction = y > lastY ? 1 : -1;
      lastY = y;
      scrolledAt = performance.now();
      schedule();
    };
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
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", schedule);
    wide.addEventListener?.("change", setPrism);
    setPrism();
    // Measure once before the styles switch on, then let anything already on screen settle in.
    frame(performance.now());
    schedule();
    root.dataset.story = "live";

    return () => {
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      root.removeEventListener("click", onClick);
      root.removeEventListener("focusin", onFocusIn);
      root.removeEventListener("pointermove", onPointerMove);
      root.removeEventListener("pointerout", onPointerOut);
      window.removeEventListener("scroll", onScroll);
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
