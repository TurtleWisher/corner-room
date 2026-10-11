import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { LitSurface } from "@/components/brand/corner-light";
import { CubeLogo } from "@/components/brand/cube-logo";
import { cubeFaces } from "@/components/brand/cube-logo/geometry";
import { Logo } from "@/components/brand/logo";
import { RoomCube } from "@/components/brand/room-cube";
import { Badge } from "@/components/ds";
import type { ThemeName } from "@/lib/theme/palette";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Letter cube · Corner Room", robots: { index: false, follow: false } };

/*
 * Letter cube demo (components/brand/cube-logo). Developer reference only: hidden in production
 * unless CR_THEME_KIT=1. Titles below are SAMPLE CONTENT shaped like API records.
 */

const SETS: { title: string; secondary: string }[] = [
  { title: "Low Tide", secondary: "Sessions" },
  { title: "Night Bus", secondary: "Kaal Bela" },
  { title: "Monsoon Frequencies", secondary: "Chattogram" },
];

function Section({ index, title, note, children }: { index: string; title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-line px-6 py-12 md:px-12" aria-labelledby={`c-${index}`}>
      <div className="mb-8 flex flex-wrap items-baseline gap-x-5 gap-y-2">
        <span className="cr-num text-sm text-highlight">{index}</span>
        <h2 id={`c-${index}`} className="font-ui text-xl font-extrabold tracking-tight text-fg">
          {title}
        </h2>
        {note ? <p className="text-sm text-fg-muted">{note}</p> : null}
      </div>
      {children}
    </section>
  );
}

export default function CubePage() {
  if (process.env.NODE_ENV === "production" && process.env.CR_THEME_KIT !== "1") notFound();

  return (
    <div data-theme="ember" className="cr-scope min-h-dvh">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-line px-6 py-5 md:px-12">
        <h1 className="font-ui text-lg font-extrabold text-fg">Letter cube · the cube is made of the words</h1>
        <Badge tone="accent">Sample titles, not real data</Badge>
      </header>

      <Section index="01" title="Default mark against the official logo" note="Left: official SVG from brand/logo. Right: CubeLogo, unframed.">
        <div className="grid gap-6 md:grid-cols-2">
          {(["ice", "fire"] as const).map((theme) => (
            <div key={theme} className="grid grid-cols-2 gap-3" data-cr-theme={theme} style={{ background: "var(--cr-cube-field)" }}>
              <div className="p-6">
                <Logo variant={theme === "ice" ? "indigo" : "ember"} height={240} className="h-auto w-full" alt="Official logo" />
              </div>
              <div className="p-6">
                <CubeLogo theme={theme} framed={false} title="Corner Room, generated" />
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section index="02" title="Framed, both themes" note="1920 master canvas, flat background, about 440 units of margin.">
        <div className="grid gap-6 sm:grid-cols-2">
          <CubeLogo theme="ice" />
          <CubeLogo theme="fire" />
        </div>
      </Section>

      <Section index="03" title="Event and release titles" note="Words come from the title and one secondary value; cubeFaces places them.">
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {SETS.map((s, i) => {
            const f = cubeFaces(s.title, s.secondary);
            return (
              <figure key={s.title} className="space-y-3">
                <CubeLogo {...f} theme={i % 2 ? "ice" : "fire"} title={`${s.title}, ${s.secondary}`} />
                <figcaption className="font-mono text-xs text-fg-muted">
                  {`front ${f.front.join(" / ")} · left ${f.left} · top ${f.top}`}
                </figcaption>
              </figure>
            );
          })}
        </div>
      </Section>

      <Section index="04" title="Inside each world" note='theme="theme" follows the surrounding world tokens.'>
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          {(["ember", "sky", "staff", "paper"] as ThemeName[]).map((w) => (
            <LitSurface key={w} theme={w} as="div" className="border border-line" contentClassName="p-6">
              <p className="cr-eyebrow mb-4 text-fg-muted">{w}</p>
              <RoomCube front="Low Tide" side="Sessions" />
            </LitSurface>
          ))}
        </div>
      </Section>

      <Section index="05" title="Sizes" note="Under 96 px the simplified front-only mark is used.">
        <div className="flex flex-wrap items-end gap-8">
          {[256, 160, 96].map((px) => (
            <figure key={px} style={{ width: px }} className="space-y-2">
              <CubeLogo theme="fire" />
              <figcaption className="cr-num text-xs text-fg-muted">{px} px</figcaption>
            </figure>
          ))}
          {[64, 44].map((px) => (
            <figure key={px} style={{ width: px }} className="space-y-2">
              <CubeLogo theme="fire" variant="front" />
              <figcaption className="cr-num text-xs text-fg-muted">{px} px</figcaption>
            </figure>
          ))}
        </div>
      </Section>

      <Section index="06" title="Assembly on mount" note="Left from x-40, top from y-40, front fades. Off under reduced motion.">
        <div className="max-w-xs">
          <CubeLogo theme="ice" animate />
        </div>
      </Section>
    </div>
  );
}
