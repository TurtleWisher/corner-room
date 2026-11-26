"use client";

/*
 * The closing story's motion (owner, 2026-11-26): one scroll listener for the whole end of the home
 * page. It measures, at most once a frame, how far each moving block has come in and how far the
 * reader is through the pinned prism scene, glides toward those values, and writes them as CSS
 * variables (--k, --turn, --lit, --door). The styles in app/styles/modules/home-story.css turn them
 * into transforms and opacity. React never re-renders for motion.
 *
 * Nothing moves by itself: the loop runs only while a value is still gliding after a scroll, a
 * resize or a pointer move. Without JavaScript, under reduced motion, or before this runs, every
 * block is simply shown as it is (data-story is set only once the engine is live).
 *
 * Hooks in the markup:
 *   [data-k]              comes in as the page scrolls (--k 0 to 1); data-k-lag delays it a little
 *                         (a fraction of the window), data-k-range sets how long it takes.
 *   [data-door]           also gets --door, the closing door's swing in degrees.
 *   [data-prism-scene]    a pinned scene whose [data-face] children turn as a prism (wide screens).
 *   [data-face-go="i"]    a button that brings face i to the front.
 *   [data-tilt]           leans toward a fine pointer (--rx, --ry).
 */

import * as React from "react";

import {
  doorAngle,
  enterProgress,
  faceLight,
  frontFace,
  glide,
  leanToward,
  prismTurn,
  sceneProgress,
  scrollForFace,
} from "@/lib/home-story-view";

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
    const kNow = new Map<HTMLElement, number>();
    const turnNow = new Map<HTMLElement, number>();
    let raf = 0;
    let last = 0;
    let destroyed = false;

    const prismOn = () => !reduced && wide.matches;

    function frame(t: number) {
      raf = 0;
      if (destroyed) return;
      const dt = last ? Math.min((t - last) / 1000, 0.1) : 1 / 60;
      last = t;
      const vh = window.innerHeight;
      // At the very end of the page everything has arrived, however short the space below it.
      const atEnd = window.scrollY + vh >= document.documentElement.scrollHeight - 2;
      let moving = false;

      for (const el of blocks) {
        const r = el.getBoundingClientRect();
        const lag = Number(el.dataset.kLag) || 0;
        const range = Number(el.dataset.kRange) || 0.45;
        const target = atEnd ? 1 : enterProgress(r.top + lag * vh, vh, range);
        const cur = kNow.get(el);
        const next = cur === undefined ? target : glide(cur, target, dt, 7.5);
        if (next !== target) moving = true;
        if (next === cur) continue;
        kNow.set(el, next);
        el.style.setProperty("--k", next.toFixed(4));
        if (el.dataset.door !== undefined) el.style.setProperty("--door", `${doorAngle(next).toFixed(2)}deg`);
      }

      if (prismOn()) {
        for (const scene of scenes) {
          const faces = Array.from(scene.querySelectorAll<HTMLElement>("[data-face]"));
          const n = faces.length;
          const r = scene.getBoundingClientRect();
          const target = prismTurn(sceneProgress(r.top, r.height, vh), n);
          const cur = turnNow.get(scene);
          const next = cur === undefined ? target : glide(cur, target, dt, 6.5);
          if (next !== target) moving = true;
          if (next === cur) continue;
          turnNow.set(scene, next);
          scene.style.setProperty("--turn", next.toFixed(4));
          const front = frontFace(next, n);
          if (scene.dataset.front !== String(front)) {
            scene.dataset.front = String(front);
            faces.forEach((f, i) => (i === front ? (f.dataset.front = "") : delete f.dataset.front));
            scene.querySelectorAll<HTMLElement>("[data-face-go]").forEach((b) => b.setAttribute("aria-current", b.dataset.faceGo === String(front) ? "true" : "false"));
          }
          faces.forEach((f, i) => f.style.setProperty("--lit", faceLight(i, next, n).toFixed(3)));
        }
      }

      if (moving) raf = requestAnimationFrame(frame);
      else last = 0;
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
    // Measure once before the styles switch on, so blocks already on screen never blink.
    frame(performance.now());
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
