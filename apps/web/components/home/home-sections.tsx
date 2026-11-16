"use client";

/*
 * The longer home page (owner, 2026-11-15): what Corner Room is, how listening works, what artists
 * get, the usual questions and a way in. Words live in lib/home-sections-view.ts (tested: real
 * product facts only, real pages only). Cards catch the pointer's light (components/ds/spotlight).
 */

import Link from "next/link";
import { useEffect, useRef } from "react";
import { ArrowRight, ArrowUpRight, Disc3, Headphones, Mic2, Plus, Ticket, type LucideIcon } from "lucide-react";

import { useAuth } from "@/components/auth-provider";
import { Display, Eyebrow } from "@/components/brand/display";
import { ButtonLink } from "@/components/ds";
import { Reveal } from "@/components/ds/reveal";
import { SpotlightRegion } from "@/components/ds/spotlight";
import { ARTIST_POINTS, FACES, LISTEN_STEPS, QUESTIONS, worldLayers, worldProgress, type Face } from "@/lib/home-sections-view";

const FACE_ICONS: Record<Face["key"], LucideIcon> = { live: Ticket, listen: Headphones, own: Disc3 };

/** A section's opening lines: small label, Sikat title, one supporting sentence. */
function Lead({ id, eyebrow, title, body }: { id: string; eyebrow: string; title: string; body?: string }) {
  return (
    <Reveal className="home-lead">
      <Eyebrow>{eyebrow}</Eyebrow>
      <Display as="h2" id={id} size="md" className="mt-4 max-w-4xl leading-[0.94]">
        {title}
      </Display>
      {body ? <p className="cr-display-line mt-4 max-w-2xl text-base text-fg md:text-lg">{body}</p> : null}
    </Reveal>
  );
}

/* ---------- What Corner Room is: three sides of one room ---------- */

export function RoomFaces() {
  return (
    <section aria-labelledby="home-faces" className="home-block">
      <Lead id="home-faces" eyebrow="What Corner Room is" title="One room. Every side of the music." body="Shows, songs and the people who make them, in one place made in Dhaka." />
      <SpotlightRegion as="ul" className="home-faces mt-10">
        {FACES.map((face, i) => {
          const Icon = FACE_ICONS[face.key];
          return (
            <Reveal as="li" key={face.key} index={i}>
              <Link href={face.href} data-spot className="home-face cr-cut cr-glass-card cr-hover cr-spot cr-focus">
                <span className="home-face-top">
                  <span aria-hidden="true" className="home-face-index cr-num">
                    {face.index}
                  </span>
                  <Icon aria-hidden="true" className="size-6 text-highlight" />
                </span>
                <span className="home-face-title cr-display">{face.title}</span>
                <span className="home-face-body">{face.body}</span>
                <span className="home-face-points">
                  {face.points.map((point) => (
                    <span key={point} className="home-face-point">
                      {point}
                    </span>
                  ))}
                </span>
                <span className="home-face-link">
                  {face.link} <ArrowUpRight aria-hidden="true" className="size-4" />
                </span>
              </Link>
            </Reveal>
          );
        })}
      </SpotlightRegion>
    </section>
  );
}

/* ---------- How listening works (Sky) ---------- */

export function HowListeningWorks() {
  return (
    <section aria-labelledby="home-how" className="home-block mx-auto max-w-[90rem] px-4 md:px-6">
      <Lead id="home-how" eyebrow="How it works" title="From first listen to yours for good." />
      <ol className="home-steps mt-10">
        {LISTEN_STEPS.map((step, i) => (
          <Reveal as="li" key={step.title} index={i} className="home-step">
            <span aria-hidden="true" className="home-step-n cr-num">
              {String(i + 1).padStart(2, "0")}
            </span>
            <span className="home-step-rule" aria-hidden="true" />
            <h3 className="home-step-title">{step.title}</h3>
            <p className="home-step-body">{step.body}</p>
          </Reveal>
        ))}
      </ol>
    </section>
  );
}

/* ---------- For artists (Sky) ---------- */

export function ForArtists() {
  return (
    <section aria-labelledby="home-artists" className="home-block mx-auto max-w-[90rem] px-4 md:px-6">
      <SpotlightRegion className="home-artists cr-cut cr-glass-card cr-spot" data-spot>
        <div className="home-artists-lead">
          <p className="flex items-center gap-2">
            <Mic2 aria-hidden="true" className="size-5 text-highlight" />
            <span className="cr-eyebrow">For artists and bands</span>
          </p>
          <Display as="h2" id="home-artists" size="md" className="mt-4 leading-[0.94]">
            Release it your way.
          </Display>
          <p className="cr-display-line mt-4 max-w-md text-base text-fg md:text-lg">
            The Artist Studio is where you upload, price and release your music, and stay close to the people who buy it.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <ButtonLink href="/artists/apply" size="lg" className="home-cta-go">
              Apply as an artist <ArrowRight aria-hidden="true" />
            </ButtonLink>
            <ButtonLink href="/studio/sign-in" size="lg" variant="secondary">
              Open the Studio
            </ButtonLink>
          </div>
        </div>
        <ul className="home-artists-points">
          {ARTIST_POINTS.map((point) => (
            <li key={point.title} className="home-artists-point">
              <h3>{point.title}</h3>
              <p>{point.body}</p>
            </li>
          ))}
        </ul>
      </SpotlightRegion>
    </section>
  );
}

/* ---------- Questions (Sky) ---------- */

export function Questions() {
  return (
    <section aria-labelledby="home-questions" className="home-block mx-auto grid max-w-[90rem] gap-x-14 gap-y-8 px-4 md:px-6 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
      <Lead id="home-questions" eyebrow="Good to know" title="Questions, answered plainly." />
      <Reveal className="home-faq">
        {QUESTIONS.map((item) => (
          <details key={item.q} className="home-faq-item">
            <summary className="cr-focus">
              <span>{item.q}</span>
              <Plus aria-hidden="true" className="home-faq-mark size-5" />
            </summary>
            <div className="home-faq-answer">
              <p>{item.a}</p>
              {item.link ? (
                <Link href={item.link.href} className="cr-focus home-faq-link">
                  {item.link.label} <ArrowRight aria-hidden="true" className="size-4" />
                </Link>
              ) : null}
            </div>
          </details>
        ))}
      </Reveal>
    </section>
  );
}

/* ---------- The way in (Sky) ---------- */

export function ClosingCall() {
  const { status } = useAuth();
  const signedIn = status === "authenticated";
  return (
    <section aria-labelledby="home-closing" className="home-closing mx-auto max-w-[90rem] px-4 md:px-6">
      <Reveal className="home-closing-inner">
        <Display as="h2" id="home-closing" size="lg" className="leading-[0.9]">
          <span className="block">The door&apos;s open.</span>
          <span className="block text-highlight">Come in.</span>
        </Display>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          {signedIn ? (
            <ButtonLink href="/library" size="lg" className="home-cta-go">
              Open your library <ArrowRight aria-hidden="true" />
            </ButtonLink>
          ) : (
            <ButtonLink href="/register" size="lg" className="home-cta-go">
              Create an account <ArrowRight aria-hidden="true" />
            </ButtonLink>
          )}
          <ButtonLink href="/events" size="lg" variant="secondary">
            See what&apos;s on
          </ButtonLink>
          <ButtonLink href="/store" size="lg" variant="ghost">
            Visit the Store
          </ButtonLink>
        </div>
      </Reveal>
    </section>
  );
}

/* ---------- The whole screen changes world as you scroll (brand D1, made full-screen 2026-11-15) ---------- */

/**
 * Ember hands over to Sky across the whole window, not only inside the hand-over strip: a dark veil
 * rises first, then the Sky corner light, both fixed to the window beneath all content. The two
 * lights never overlap (worldLayers). The scroll handler only measures the strip and writes two CSS
 * variables on <main>, at most once a frame; React never re-renders. Reduced motion keeps the
 * still strip the page already had (no listener, no layers).
 */
export function WorldShift({ children }: { children: React.ReactNode }) {
  const zone = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = zone.current;
    const main = el?.closest<HTMLElement>("main");
    if (!el || !main || typeof window.matchMedia !== "function") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const r = el.getBoundingClientRect();
      const { veil, sky } = worldLayers(worldProgress(r.top, r.bottom, window.innerHeight));
      main.style.setProperty("--hw-veil", veil.toFixed(3));
      main.style.setProperty("--hw-sky", sky.toFixed(3));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    main.dataset.worldLive = "";
    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
      delete main.dataset.worldLive;
      main.style.removeProperty("--hw-veil");
      main.style.removeProperty("--hw-sky");
    };
  }, []);
  return (
    <>
      <div aria-hidden="true" className="home-world">
        <div className="home-world-veil" />
        <div className="home-world-sky" data-theme="sky">
          <div className="cr-light" />
        </div>
      </div>
      <div ref={zone} aria-hidden="true" className="home-handover">
        {children}
      </div>
    </>
  );
}
