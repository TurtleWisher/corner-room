"use client";

/*
 * The home page's hover depth (owner, 2026-11-28): one pointer listener on the page's <main>.
 *
 *   [data-lean="deg"]   leans toward the mouse (up to deg), lifts toward the reader and catches the
 *                       light where the pointer is: --lx / --ly (degrees), --lh (0 to 1, how far it
 *                       has lifted), --mx / --my (the light, in %). The Upcoming rows
 *                       (.home-rows > li) lean too, by LEAN_ROWS.
 *   [data-parallax]     a region whose layers drift apart under the mouse: --px / --py (-1 to 1).
 *   [data-spot]         gets --sx / --sy for the glass cards' own spotlight (styles/spotlight.css).
 *   pressing a lean element marks it [data-pressed] until the button comes up, so a click is felt.
 *
 * Every value glides (lib/home-motion-view.ts) and rests again when the mouse leaves; the loop runs
 * only while something is still moving. Mice only: touch, pens, keyboards and reduced motion get the
 * page as it is, and the styles wait for [data-motion="live"] on <main>, which only this sets.
 * React never re-renders.
 */

import * as React from "react";

import { LEAN_RATE, REST_RATE, leanDegrees, leanFor, pointerIn } from "@/lib/home-motion-view";
import { glide } from "@/lib/home-story-view";

const LEAN = "[data-lean], .home-rows > li";
const LEAN_ROWS = 1.4;

type Lean = { x: number; y: number; h: number; tx: number; ty: number; th: number };
type Drift = { x: number; y: number; tx: number; ty: number };

export function useHomeMotion(): void {
  React.useEffect(() => {
    const main = document.querySelector<HTMLElement>('main[data-module="home"]');
    if (!main || typeof window.matchMedia !== "function") return;
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const leans = new Map<HTMLElement, Lean>();
    const drifts = new Map<HTMLElement, Drift>();
    let leaning: HTMLElement | null = null;
    let drifting: HTMLElement | null = null;
    let raf = 0;
    let last = 0;
    let destroyed = false;

    const schedule = () => {
      if (!raf && !destroyed) raf = requestAnimationFrame(frame);
    };

    function frame(t: number) {
      raf = 0;
      if (destroyed) return;
      const dt = last ? Math.min((t - last) / 1000, 0.1) : 1 / 60;
      last = t;
      let moving = false;
      for (const [el, s] of leans) {
        const rate = s.th > 0 ? LEAN_RATE : REST_RATE;
        s.x = glide(s.x, s.tx, dt, rate);
        s.y = glide(s.y, s.ty, dt, rate);
        s.h = glide(s.h, s.th, dt, rate);
        if (s.x === s.tx && s.y === s.ty && s.h === s.th) {
          if (s.th === 0) {
            for (const p of ["--lx", "--ly", "--lh"]) el.style.removeProperty(p);
            delete el.dataset.leaning;
            leans.delete(el);
            continue;
          }
        } else moving = true;
        el.style.setProperty("--lx", `${s.x.toFixed(2)}deg`);
        el.style.setProperty("--ly", `${s.y.toFixed(2)}deg`);
        el.style.setProperty("--lh", s.h.toFixed(3));
      }
      for (const [el, s] of drifts) {
        const rate = el === drifting ? LEAN_RATE * 0.5 : REST_RATE * 0.6;
        s.x = glide(s.x, s.tx, dt, rate);
        s.y = glide(s.y, s.ty, dt, rate);
        if (s.x === s.tx && s.y === s.ty) {
          if (el !== drifting && s.x === 0 && s.y === 0) {
            el.style.removeProperty("--px");
            el.style.removeProperty("--py");
            drifts.delete(el);
            continue;
          }
        } else moving = true;
        el.style.setProperty("--px", s.x.toFixed(3));
        el.style.setProperty("--py", s.y.toFixed(3));
      }
      if (moving) raf = requestAnimationFrame(frame);
      else last = 0;
    }

    const release = (el: HTMLElement | null) => {
      if (!el) return;
      const s = leans.get(el);
      if (s) {
        s.tx = 0;
        s.ty = 0;
        s.th = 0;
      }
      delete el.dataset.pressed;
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      const target = e.target instanceof Element ? e.target : null;

      const el = target?.closest<HTMLElement>(LEAN) ?? null;
      if (el !== leaning) {
        release(leaning);
        leaning = el && main.contains(el) ? el : null;
      }
      if (leaning) {
        const r = leaning.getBoundingClientRect();
        const p = pointerIn(e.clientX, e.clientY, r);
        const max = leaning.matches(".home-rows > li") ? LEAN_ROWS : leanDegrees(leaning.dataset.lean);
        const { turnX, turnY } = leanFor(p.x, p.y, max);
        let s = leans.get(leaning);
        if (!s) {
          s = { x: 0, y: 0, h: 0, tx: 0, ty: 0, th: 0 };
          leans.set(leaning, s);
        }
        s.tx = turnY;
        s.ty = turnX;
        s.th = 1;
        leaning.dataset.leaning = "";
        leaning.style.setProperty("--mx", `${p.mx}%`);
        leaning.style.setProperty("--my", `${p.my}%`);
      }

      const region = target?.closest<HTMLElement>("[data-parallax]") ?? null;
      if (region !== drifting) {
        if (drifting) {
          const old = drifts.get(drifting);
          if (old) {
            old.tx = 0;
            old.ty = 0;
          }
        }
        drifting = region;
      }
      if (drifting) {
        const p = pointerIn(e.clientX, e.clientY, drifting.getBoundingClientRect());
        let s = drifts.get(drifting);
        if (!s) {
          s = { x: 0, y: 0, tx: 0, ty: 0 };
          drifts.set(drifting, s);
        }
        s.tx = p.x;
        s.ty = p.y;
      }

      const spot = target?.closest<HTMLElement>("[data-spot]");
      if (spot) {
        const r = spot.getBoundingClientRect();
        spot.style.setProperty("--sx", `${(e.clientX - r.left).toFixed(0)}px`);
        spot.style.setProperty("--sy", `${(e.clientY - r.top).toFixed(0)}px`);
      }
      schedule();
    };

    const onLeave = () => {
      release(leaning);
      leaning = null;
      for (const s of drifts.values()) {
        s.tx = 0;
        s.ty = 0;
      }
      drifting = null;
      schedule();
    };
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || e.button !== 0) return;
      const el = (e.target instanceof Element ? e.target : null)?.closest<HTMLElement>(LEAN);
      if (el) el.dataset.pressed = "";
    };
    const onUp = () => {
      main.querySelectorAll<HTMLElement>("[data-pressed]").forEach((el) => delete el.dataset.pressed);
    };

    main.addEventListener("pointermove", onMove, { passive: true });
    main.addEventListener("pointerleave", onLeave);
    main.addEventListener("pointerdown", onDown);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("blur", onLeave);
    main.dataset.motion = "live";

    return () => {
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      main.removeEventListener("pointermove", onMove);
      main.removeEventListener("pointerleave", onLeave);
      main.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("blur", onLeave);
      delete main.dataset.motion;
      for (const el of leans.keys()) for (const p of ["--lx", "--ly", "--lh", "--mx", "--my"]) el.style.removeProperty(p);
      for (const el of drifts.keys()) for (const p of ["--px", "--py"]) el.style.removeProperty(p);
    };
  }, []);
}
