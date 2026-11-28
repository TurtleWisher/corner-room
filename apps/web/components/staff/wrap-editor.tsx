"use client";

/* Staff > Marketing > Corner Room Wrap (owner, 2026-11-28, D-WRAP-01): one Wrap end to end. Basics
 * (name, period, when it opens and closes), Look (carnival look, dither, motion, pace), Cards
 * (on or off, order, every headline), Rules and sharing (who gets one, top-list size, fan rank,
 * share switches), and Live (go live, end, rebuild, counts). A live sample beside it shows the look
 * on sample numbers, and "Preview with my listening" opens the real story built from the staff
 * member's own activity. The API checks every value and decides who may do it. */

import { ArrowDown, ArrowUp, CircleAlert, ExternalLink, RefreshCw, Save, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ds/button";
import { Dialog } from "@/components/ds/dialog";
import { Field } from "@/components/ds/field";
import { Input, Select, Textarea } from "@/components/ds/input";
import { Tabs } from "@/components/ds/tabs";
import { WrapCardView } from "@/components/wrap/wrap-cards";
import { createWrapDither, type WrapDitherScene } from "@/components/wrap/wrap-dither";
import {
  deleteWrap,
  rebuildWrap,
  transitionWrap,
  updateWrap,
  type MyWrap,
  type StaffWrap,
  type WrapCardKey,
  type WrapOptions,
  type WrapSettings,
  type WrapStatus,
} from "@/features/wraps/api";
import { friendlyError } from "@/lib/error-copy";
import { formatCount } from "@/lib/format/count";
import {
  CARD_WORDS,
  LOOK_WORDS,
  STATUS_WORDS,
  dhakaInputToIso,
  isoToDhakaInput,
  moveCard,
  transitionWords,
  worldFor,
} from "@/lib/wrap-view";

type Form = {
  name: string;
  starts_on: string;
  ends_on: string;
  opens_at: string;
  closes_at: string;
  settings: WrapSettings;
};

function formOf(w: StaffWrap): Form {
  return {
    name: w.name,
    starts_on: w.starts_on,
    ends_on: w.ends_on,
    opens_at: isoToDhakaInput(w.opens_at),
    closes_at: isoToDhakaInput(w.closes_at),
    settings: structuredClone(w.settings),
  };
}

/** Sample numbers for the look preview only (labelled as such on the page; never shown to fans). */
function sampleWrap(w: StaffWrap, form: Form, firstName: string | null): MyWrap {
  const songs = ["Sample song one", "Sample song two", "Sample song three", "Sample song four", "Sample song five"];
  return {
    season: {
      ...w,
      name: form.name,
      tagline: form.settings.tagline,
      intro: form.settings.intro,
      outro: form.settings.outro,
      look: form.settings.look,
      dither: form.settings.dither,
      slide_seconds: form.settings.slide_seconds,
      sharing: form.settings.sharing,
      year: Number(form.ends_on.slice(0, 4)) || w.year,
    },
    preview: true,
    person: { name: firstName, first_name: firstName },
    enough: true,
    min_listens: form.settings.rules.min_listens,
    cards: [],
    stats: {
      period: { starts_on: form.starts_on, ends_on: form.ends_on },
      listens: 812,
      minutes: 2436,
      songs: 64,
      acts: 18,
      top_songs: songs.slice(0, form.settings.rules.top_count).map((title, i) => ({ track_id: `sample-${i}`, title, act_id: null, act: "Sample act", listens: 90 - i * 12, minutes: 270 - i * 30 })),
      top_acts: ["Sample act", "Second act", "Third act", "Fourth act", "Fifth act"].slice(0, form.settings.rules.top_count).map((name, i) => ({ act_id: `sample-act-${i}`, name, kind: "SOLO" as const, picture: null, listens: 120 - i * 20, songs: 8 - i })),
      fan_rank: { act_id: "sample-act-0", act: "Sample act", rank: 3, listeners: 240, top_percent: 2 },
      hours: [3, 1, 0, 0, 0, 1, 4, 8, 10, 9, 7, 6, 8, 9, 7, 6, 9, 14, 20, 26, 31, 28, 19, 9],
      peak_hour: 20,
      day_part: "SUNDOWN",
      months: Array.from({ length: 12 }, (_, i) => ({ month: `${form.ends_on.slice(0, 4)}-${String(i + 1).padStart(2, "0")}`, listens: [30, 42, 51, 38, 60, 72, 66, 81, 95, 88, 102, 87][i] })),
      streak: { days: 12, from: form.starts_on, to: form.starts_on },
      busiest_day: { day: form.starts_on, listens: 31 },
      first_song: null,
      new_songs: 23,
      new_acts: 6,
      new_act_names: ["Sample act", "Second act"],
      bought: { songs: 7, releases: 2, preorders: 1, first: { kind: "TRACK", id: "sample-0", day: form.starts_on, title: "Sample song one" } },
      events: { tickets: 3, events: 2, attended: 2, list: [] },
      gifts: { given: 2, received: 1 },
      follows: 4,
    },
  };
}

function Switch({ on, label, line, onChange }: { on: boolean; label: string; line: string; onChange: (on: boolean) => void }) {
  return (
    <div className="wre-switch-row">
      <div>
        <p className="font-semibold">{label}</p>
        <p className="text-sm text-fg-muted">{line}</p>
      </div>
      <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} className="wre-switch cr-focus">
        <span aria-hidden className="wre-switch-thumb" />
      </button>
    </div>
  );
}

/** The live sample: the real card component in the chosen look over the real dither. */
function LookPreview({ wrap, cardKey, title, index }: { wrap: MyWrap; cardKey: WrapCardKey; title: string | null; index: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const scene = useRef<WrapDitherScene | null>(null);
  const world = worldFor(wrap.season.look, index);
  const { cell, style, motion } = wrap.season.dither;
  const speed = motion === "LIVELY" ? 1 : motion === "CALM" ? 0.35 : 0;
  useEffect(() => {
    if (!canvas.current) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    scene.current = createWrapDither(canvas.current, world, { cell, style, speed: still ? 0 : speed });
    return () => scene.current?.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => scene.current?.setWorld(world), [world]);
  useEffect(() => scene.current?.setOptions({ cell, style, speed }), [cell, style, speed]);
  const card = { key: cardKey, title };
  const ctx = { firstName: wrap.person.first_name, name: wrap.person.name, year: wrap.season.year, stats: wrap.stats };
  return (
    <div className="wr-root wr-embed" data-world={world} data-look={wrap.season.look}>
      <canvas ref={canvas} className="wr-dither" aria-hidden />
      <div className="wr-vignette" aria-hidden />
      <div className="wr-stage">
        <span className="wr-badge wre-sample">Sample numbers</span>
        <section className="wr-slot">
          <WrapCardView key={`${cardKey}-${index}`} card={card} wrap={wrap} ctx={ctx} onPlay={() => undefined} />
        </section>
      </div>
    </div>
  );
}

function Numbers({ w }: { w: StaffWrap }) {
  const n = w.numbers;
  const tiles: [string, number | undefined, string][] = [
    ["People with listens in its time", w.people_with_listens, "Accounts with at least one counted listen in the period"],
    ["Wraps made", n.built, "People who opened theirs (numbers kept)"],
    ["Watched to the end", n.finished, "Reached the last card"],
    ["Shared to a story", n.shared_sheet, "Opened the share sheet and sent it"],
    ["Pictures saved", n.shared_save, "Saved the story picture"],
    ["Links copied", n.shared_link, "Copied the Wrap link"],
    ["Top songs played", n.played, "Pressed play from their Wrap"],
  ];
  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {tiles.map(([label, value, line]) => (
          <div key={label} className="wre-tile">
            <span className="wre-tile-v">{value === undefined ? "Not available" : formatCount(value)}</span>
            <span className="wre-tile-l">{label}</span>
            <span className="wre-tile-line">{line}</span>
          </div>
        ))}
      </div>
      {w.days?.length ? (
        <div className="overflow-x-auto">
          <table className="wre-table">
            <caption className="sr-only">Counts per day, Dhaka time</caption>
            <thead>
              <tr>
                <th scope="col">Day</th>
                <th scope="col">Opened</th>
                <th scope="col">Finished</th>
                <th scope="col">Shared</th>
                <th scope="col">Saved</th>
                <th scope="col">Links</th>
                <th scope="col">Played</th>
              </tr>
            </thead>
            <tbody>
              {[...w.days].reverse().map((d) => (
                <tr key={d.day}>
                  <th scope="row">{d.day}</th>
                  <td>{formatCount(d.opened)}</td>
                  <td>{formatCount(d.finished)}</td>
                  <td>{formatCount(d.shared_sheet)}</td>
                  <td>{formatCount(d.shared_save)}</td>
                  <td>{formatCount(d.shared_link)}</td>
                  <td>{formatCount(d.played)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-fg-muted">No counts yet. They start once fans open it.</p>
      )}
      <p className="text-xs text-fg-muted">Counts only. Corner Room never keeps who shared, saved or played.</p>
    </div>
  );
}

export function WrapEditor({ initial, options, staffFirstName }: { initial: StaffWrap; options: WrapOptions; staffFirstName: string | null }) {
  const router = useRouter();
  const [wrap, setWrap] = useState(initial);
  const [form, setForm] = useState<Form>(() => formOf(initial));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [previewKey, setPreviewKey] = useState<WrapCardKey>("INTRO");
  const [ask, setAsk] = useState<null | { title: string; body: string; label: string; run: () => Promise<void> }>(null);
  const saved = useMemo(() => JSON.stringify(formOf(wrap)), [wrap]);
  const dirty = JSON.stringify(form) !== saved;
  const s = form.settings;
  const set = (patch: Partial<WrapSettings>) => setForm((f) => ({ ...f, settings: { ...f.settings, ...patch } }));

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  async function run(action: () => Promise<StaffWrap | void>, done?: string) {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const next = await action();
      if (next) {
        setWrap(next);
        setForm(formOf(next));
      }
      if (done) setNote(done);
    } catch (err) {
      setError(friendlyError(err, "That didn't work. Reload and try again."));
    } finally {
      setBusy(false);
    }
  }

  const save = () =>
    run(
      () =>
        updateWrap(wrap.id, {
          version: wrap.version,
          name: form.name,
          starts_on: form.starts_on,
          ends_on: form.ends_on,
          window: { opens_at: dhakaInputToIso(form.opens_at), closes_at: dhakaInputToIso(form.closes_at) },
          settings: form.settings,
        }),
      "Saved. Fans see the change the next time they open their Wrap.",
    );

  const move = (to: WrapStatus) => {
    const words = transitionWords(wrap.status, to);
    setAsk({
      title: `${words.label}?`,
      body: dirty ? `${words.confirm} Your unsaved changes are not part of this: save them first if they should be.` : words.confirm,
      label: words.label,
      run: () => run(() => transitionWrap(wrap.id, to), `${STATUS_WORDS[to]}.`),
    });
  };

  const sample = useMemo(() => sampleWrap(wrap, form, staffFirstName), [wrap, form, staffFirstName]);
  const cardIndex = Math.max(0, s.cards.filter((c) => c.on).findIndex((c) => c.key === previewKey));
  const previewTitle = s.cards.find((c) => c.key === previewKey)?.title ?? null;

  const [cellLo, cellHi] = options.limits.cell;
  const [slideLo, slideHi] = options.limits.slide_seconds;
  const [topLo, topHi] = options.limits.top;

  const basics = (
    <div className="grid gap-5">
      <Field label="Name" hint="Shown at the top of the story and on the Wraps list.">
        {(p) => <Input {...p} value={form.name} maxLength={80} onChange={(e) => setForm({ ...form, name: e.target.value })} />}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Activity from" hint="Dhaka days. Listens, buys, events and gifts from this day count.">
          {(p) => <Input {...p} type="date" value={form.starts_on} onChange={(e) => setForm({ ...form, starts_on: e.target.value })} />}
        </Field>
        <Field label="Activity until" hint={`Up to ${options.limits.period_days} days in all.`}>
          {(p) => <Input {...p} type="date" value={form.ends_on} onChange={(e) => setForm({ ...form, ends_on: e.target.value })} />}
        </Field>
      </div>
      <p className="text-sm text-fg-muted">Changing the period makes everyone&apos;s Wrap again from the new days the next time they open it.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Fans can open it from" hint="Dhaka time. Empty: as soon as it goes live.">
          {(p) => <Input {...p} type="datetime-local" value={form.opens_at} onChange={(e) => setForm({ ...form, opens_at: e.target.value })} />}
        </Field>
        <Field label="It closes at" hint="Dhaka time. Empty: open until you end it.">
          {(p) => <Input {...p} type="datetime-local" value={form.closes_at} onChange={(e) => setForm({ ...form, closes_at: e.target.value })} />}
        </Field>
      </div>
      <Field label="Tagline" hint={`The big line on the opening card. Fill-ins: ${options.fill_ins.join(" ")}`}>
        {(p) => <Input {...p} value={s.tagline} maxLength={options.limits.words} onChange={(e) => set({ tagline: e.target.value })} />}
      </Field>
      <Field label="Opening words" hint="Under the tagline. Optional.">
        {(p) => <Textarea {...p} rows={2} value={s.intro ?? ""} maxLength={options.limits.words * 2} onChange={(e) => set({ intro: e.target.value || null })} />}
      </Field>
      <Field label="Closing words" hint="On the last card, above Share. Optional.">
        {(p) => <Textarea {...p} rows={2} value={s.outro ?? ""} maxLength={options.limits.words * 2} onChange={(e) => set({ outro: e.target.value || null })} />}
      </Field>
    </div>
  );

  const look = (
    <div className="grid gap-5">
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-semibold">Look</legend>
        {options.looks.map((l) => (
          <label key={l} className="wre-choice" data-on={s.look === l || undefined}>
            <input type="radio" name="wre-look" checked={s.look === l} onChange={() => set({ look: l })} />
            <span>
              <span className="block font-semibold">{LOOK_WORDS[l].name}</span>
              <span className="block text-sm text-fg-muted">{LOOK_WORDS[l].line}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Dither">
          {(p) => (
            <Select {...p} value={s.dither.style} onChange={(e) => set({ dither: { ...s.dither, style: e.target.value as WrapSettings["dither"]["style"] } })}>
              <option value="BAYER">Ordered pattern</option>
              <option value="GRAIN">Fine grain</option>
            </Select>
          )}
        </Field>
        <Field label={`Dither size: ${s.dither.cell} px`}>
          {(p) => <input {...p} type="range" min={cellLo} max={cellHi} value={s.dither.cell} onChange={(e) => set({ dither: { ...s.dither, cell: Number(e.target.value) } })} className="wre-range" />}
        </Field>
        <Field label="Movement" hint="Reduced motion always keeps it still.">
          {(p) => (
            <Select {...p} value={s.dither.motion} onChange={(e) => set({ dither: { ...s.dither, motion: e.target.value as WrapSettings["dither"]["motion"] } })}>
              <option value="LIVELY">Lively</option>
              <option value="CALM">Calm</option>
              <option value="STILL">Still</option>
            </Select>
          )}
        </Field>
      </div>
      <Field label={`Seconds per card: ${s.slide_seconds}`} hint="People can pause, tap back and on at any time.">
        {(p) => <input {...p} type="range" min={slideLo} max={slideHi} value={s.slide_seconds} onChange={(e) => set({ slide_seconds: Number(e.target.value) })} className="wre-range" />}
      </Field>
    </div>
  );

  const cards = (
    <div className="grid gap-3">
      <p className="text-sm text-fg-muted">
        Cards show in this order. A card someone has nothing for is left out of their Wrap by itself (no events, no gifts). Leave a headline empty for Corner Room&apos;s words.
      </p>
      <ol className="grid gap-2">
        {s.cards.map((c, i) => (
          <li key={c.key} className="wre-card-row" data-on={c.on || undefined} data-current={previewKey === c.key || undefined}>
            <div className="flex items-center gap-2">
              <span className="w-6 text-right text-sm font-semibold tabular-nums">{i + 1}</span>
              <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setPreviewKey(c.key)} aria-label={`Show ${CARD_WORDS[c.key].name} in the sample`}>
                <span className="block font-semibold">{CARD_WORDS[c.key].name}</span>
                <span className="block text-sm text-fg-muted">{CARD_WORDS[c.key].about}</span>
              </button>
              <button
                type="button"
                role="switch"
                aria-checked={c.on}
                aria-label={`${CARD_WORDS[c.key].name} card`}
                className="wre-switch cr-focus"
                onClick={() => set({ cards: s.cards.map((x) => (x.key === c.key ? { ...x, on: !x.on } : x)) })}
              >
                <span aria-hidden className="wre-switch-thumb" />
              </button>
              <Button size="sm" variant="ghost" aria-label={`Move ${CARD_WORDS[c.key].name} up`} disabled={i === 0} onClick={() => set({ cards: moveCard(s.cards, i, -1) })}>
                <ArrowUp aria-hidden className="size-4" />
              </Button>
              <Button size="sm" variant="ghost" aria-label={`Move ${CARD_WORDS[c.key].name} down`} disabled={i === s.cards.length - 1} onClick={() => set({ cards: moveCard(s.cards, i, 1) })}>
                <ArrowDown aria-hidden className="size-4" />
              </Button>
            </div>
            <Input
              aria-label={`${CARD_WORDS[c.key].name} headline`}
              placeholder={CARD_WORDS[c.key].headline}
              value={c.title ?? ""}
              maxLength={options.limits.title}
              onFocus={() => setPreviewKey(c.key)}
              onChange={(e) => set({ cards: s.cards.map((x) => (x.key === c.key ? { ...x, title: e.target.value || null } : x)) })}
              className="mt-2"
            />
          </li>
        ))}
      </ol>
    </div>
  );

  const rules = (
    <div className="grid gap-5">
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Listens needed for a Wrap" hint="0: any activity at all (a buy, a ticket, a gift).">
          {(p) => (
            <Input {...p} type="number" min={0} value={s.rules.min_listens} onChange={(e) => set({ rules: { ...s.rules, min_listens: Math.max(0, Math.round(Number(e.target.value) || 0)) } })} />
          )}
        </Field>
        <Field label="Songs and acts in the top lists" hint={`${topLo} to ${topHi}.`}>
          {(p) => (
            <Input {...p} type="number" min={topLo} max={topHi} value={s.rules.top_count} onChange={(e) => set({ rules: { ...s.rules, top_count: Math.round(Number(e.target.value) || topLo) } })} />
          )}
        </Field>
        <Field label="Listeners before a fan rank shows" hint="So a share of a handful of people never shows.">
          {(p) => (
            <Input
              {...p}
              type="number"
              min={1}
              value={s.rules.fan_rank_min_listeners}
              onChange={(e) => set({ rules: { ...s.rules, fan_rank_min_listeners: Math.max(1, Math.round(Number(e.target.value) || 1)) } })}
            />
          )}
        </Field>
      </div>
      <p className="text-sm text-fg-muted">Changing the top-list size or the fan-rank rule makes everyone&apos;s Wrap again the next time they open it.</p>
      <div className="grid gap-3">
        <Switch on={s.sharing.on} label="Sharing" line="People can make a story picture of their Wrap and share or save it." onChange={(on) => set({ sharing: { ...s.sharing, on } })} />
        <Switch on={s.sharing.show_name} label="First name on the picture" line="Off: the picture says “My Corner Room Wrap”." onChange={(on) => set({ sharing: { ...s.sharing, show_name: on } })} />
        <Switch on={s.sharing.show_link} label="Corner Room link" line="The picture ends with the Wrap's address, and Copy Wrap link shows." onChange={(on) => set({ sharing: { ...s.sharing, show_link: on } })} />
      </div>
    </div>
  );

  const live = (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <span className="wre-status" data-status={wrap.status}>
          {STATUS_WORDS[wrap.status]}
        </span>
        <span className="text-sm text-fg-muted">
          {wrap.fan_state === "OPEN" ? "Fans can open it now." : wrap.fan_state === "SOON" ? "Live, waiting for its opening time." : "Fans can't open it."}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {wrap.transitions.map((to) => (
          <Button key={to} variant={to === "LIVE" ? "primary" : "secondary"} disabled={busy} onClick={() => move(to)}>
            {transitionWords(wrap.status, to).label}
          </Button>
        ))}
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() =>
            setAsk({
              title: "Make every Wrap again?",
              body: "Everyone's numbers are made again from their activity the next time they open it. Use this after fixing data or changing what counts.",
              label: "Make again",
              run: () => run(() => rebuildWrap(wrap.id), "Done. Wraps are made again as people open them."),
            })
          }
        >
          <RefreshCw aria-hidden className="size-4" /> Make Wraps again
        </Button>
        {wrap.status === "DRAFT" && !wrap.went_live_at ? (
          <Button
            variant="danger"
            disabled={busy}
            onClick={() =>
              setAsk({
                title: "Delete this Wrap?",
                body: "It has never been live, so no fan has seen it. This can't be undone.",
                label: "Delete",
                run: async () => {
                  await run(async () => {
                    await deleteWrap(wrap.id);
                    router.push("/staff/wrap");
                  });
                },
              })
            }
          >
            <Trash2 aria-hidden className="size-4" /> Delete
          </Button>
        ) : null}
      </div>
      <Numbers w={wrap} />
    </div>
  );

  return (
    <div className="wre-layout">
      <div className="grid min-w-0 gap-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm">
              <Link href="/staff/wrap" className="text-link underline">
                Corner Room Wrap
              </Link>
            </p>
            <h1 className="mt-1 text-2xl font-bold">{wrap.name}</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href={`/wrap/${wrap.id}?preview=1`} className="wre-link" target="_blank" rel="noreferrer">
              <ExternalLink aria-hidden className="size-4" /> Preview with my listening
            </Link>
          </div>
        </div>
        {error ? (
          <p role="alert" className="flex items-start gap-2 text-sm text-danger">
            <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
            {error}
          </p>
        ) : null}
        {note ? (
          <p role="status" className="text-sm text-success">
            {note}
          </p>
        ) : null}
        <Tabs
          label="Wrap settings"
          keepMounted
          items={[
            { id: "basics", label: "Basics", content: basics },
            { id: "look", label: "Look", content: look },
            { id: "cards", label: "Cards", content: cards },
            { id: "rules", label: "Rules and sharing", content: rules },
            { id: "live", label: "Live and numbers", content: live },
          ]}
        />
        <div className="wre-savebar cr-bar" data-dirty={dirty || undefined}>
          <span className="text-sm">{dirty ? "Unsaved changes" : "All changes saved"}</span>
          <div className="flex gap-2">
            <Button variant="ghost" disabled={!dirty || busy} onClick={() => setForm(formOf(wrap))}>
              Undo changes
            </Button>
            <Button disabled={!dirty || busy} busy={busy} onClick={() => void save()}>
              <Save aria-hidden className="size-4" /> Save
            </Button>
          </div>
        </div>
      </div>
      <aside className="wre-preview" aria-label="Sample of the look">
        <LookPreview wrap={sample} cardKey={previewKey} title={previewTitle} index={cardIndex} />
        <p className="mt-2 text-xs text-fg-muted">Sample numbers in the chosen look. Pick a card on Cards to see it here.</p>
      </aside>
      {ask ? (
        <Dialog
          open
          onClose={() => setAsk(null)}
          title={ask.title}
          description={ask.body}
          footer={
            <>
              <Button variant="ghost" onClick={() => setAsk(null)}>
                Cancel
              </Button>
              <Button
                variant={ask.label === "Delete" ? "danger" : "primary"}
                onClick={() => {
                  const go = ask.run;
                  setAsk(null);
                  void go();
                }}
              >
                {ask.label}
              </Button>
            </>
          }
        />
      ) : null}
    </div>
  );
}
