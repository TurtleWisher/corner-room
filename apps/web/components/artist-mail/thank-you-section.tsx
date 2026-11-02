"use client";

/*
 * Thank-you emails (owner, 2026-11-02, D-MAIL-01 and D-MAIL-02): one for each audience the act
 * wants to thank differently (everyone or pre-sale buyers; any of its music, or chosen songs and
 * releases). When a purchase comes in, the most specific one that fits is sent, once per order.
 * Choosing the audience writes the words for it; fill-ins show as a real buyer's words. Changes go
 * live as soon as they're saved. A thank-you always sends: it's part of the purchase.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { HeartHandshake, PenLine, Plus, Send, Trash2 } from "lucide-react";

import { Button, Card } from "@/components/ds";
import { Segmented } from "@/components/artist-mail/audience-builder";
import { FilesPicker } from "@/components/artist-mail/files-picker";
import { MailPreview } from "@/components/artist-mail/mail-preview";
import { RichEditor } from "@/components/artist-mail/rich-editor";
import { releaseTypes, USABLE_RELEASE, WorkPicker } from "@/components/artist-mail/work-picker";
import {
  createThankYou,
  deleteThankYou,
  EMPTY_AUDIENCE,
  fetchMailPeople,
  sendTestMail,
  updateThankYou,
  type MailFile,
  type MailPerson,
  type MailProfile,
  type MailWho,
  type ThankYou,
  type ThankYouAudience,
} from "@/features/artist-mail/api";
import type { ReleaseCard } from "@/features/studio/api";
import { ApiError } from "@/lib/api/client";
import { shapeOf, thankYouStarter, type Voice } from "@/lib/artist-mail-starters";
import { previewValues, thankYouLabel, unknownFillIns, WHO_LABEL } from "@/lib/artist-mail-view";

type Shared = {
  profile: MailProfile;
  artist: string;
  voice: Voice;
  releases: ReleaseCard[];
  files: MailFile[];
  onFiles: (files: MailFile[]) => void;
  fileMaxBytes: number;
};

function ThankYouEditor({ start, onDone, onCancel, ...shared }: Shared & { start: ThankYou | null; onDone: (note: string) => void; onCancel: () => void }) {
  const { profile, artist, voice, releases } = shared;
  const types = useMemo(() => releaseTypes(releases), [releases]);
  const [audience, setAudience] = useState<ThankYouAudience>(start?.audience ?? { works: [], who: "ALL" });
  const initial = thankYouStarter(audience.who, shapeOf(audience.works, types), voice);
  const [subject, setSubject] = useState(start?.subject ?? initial.subject);
  const [body, setBody] = useState(start?.body ?? initial.body);
  const [edited, setEdited] = useState(Boolean(start));
  const [on, setOn] = useState(start?.on ?? true);
  const [fileIds, setFileIds] = useState<string[]>(start?.file_ids ?? []);
  const [people, setPeople] = useState<MailPerson[]>([]);
  const [previewRef, setPreviewRef] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "test" | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [offer, setOffer] = useState<{ subject: string; body: string } | null>(null);

  const shape = shapeOf(audience.works, types);
  const starter = thankYouStarter(audience.who, shape, voice);
  const lastStarter = useRef(`${subject}\u0000${body}`);
  const mounted = useRef(false);
  useEffect(() => {
    const next = `${starter.subject}\u0000${starter.body}`;
    if (!mounted.current) {
      mounted.current = true;
      if (start) return;
    }
    if (next === lastStarter.current) return;
    if (!edited) {
      setSubject(starter.subject);
      setBody(starter.body);
      lastStarter.current = next;
      setOffer(null);
    } else setOffer(starter);
    // starter is derived from these.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audience.who, voice, JSON.stringify(shape)]);

  // Buyers to preview as: of the chosen music, or of all the act's music for "any".
  const previewWorks = useMemo(
    () =>
      audience.works.length
        ? audience.works
        : releases.filter((r) => USABLE_RELEASE.includes(r.status)).slice(0, 200).map((r) => ({ type: "RELEASE" as const, id: r.id, title: r.title })),
    [audience.works, releases],
  );
  const { kind, id } = profile;
  const previewKey = JSON.stringify([previewWorks.map((w) => w.id), audience.who]);
  useEffect(() => {
    if (!previewWorks.length) return;
    let live = true;
    fetchMailPeople({ kind, id }, { ...EMPTY_AUDIENCE, works: previewWorks, who: audience.who })
      .then((r) => live && setPeople(r.people))
      .catch(() => live && setPeople([]));
    return () => {
      live = false;
    };
    // previewKey stands for the works and who.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, id, previewKey]);

  const person = people.find((p) => p.ref === previewRef) ?? people[0] ?? null;
  const titles = audience.works.map((w) => w.title ?? "");
  const values = previewValues(person, titles, artist);
  const work = previewWorks.find((w) => person?.bought.includes(w.title ?? "")) ?? previewWorks[0] ?? null;
  const typos = unknownFillIns(subject + "\n" + body);
  const typed = (setter: (v: string) => void) => (v: string) => {
    setter(v);
    setEdited(true);
  };

  async function save() {
    setBusy("save");
    setMessage(null);
    try {
      const data = { audience, subject, body, on, file_ids: fileIds };
      await (start ? updateThankYou(start.id, data) : createThankYou(profile, data));
      onDone(on ? `Saved. ${thankYouLabel(audience)} now get this thank-you.` : "Saved, switched off.");
    } catch (err) {
      setMessage({ ok: false, text: err instanceof ApiError ? err.message : "That didn't save. Try again." });
      setBusy(null);
    }
  }

  async function test() {
    setBusy("test");
    setMessage(null);
    try {
      await sendTestMail(profile, {
        kind: "THANK_YOU",
        subject,
        body,
        works: work ? [work] : [],
        preview: person ? { name: person.has_name ? person.name : null, music: person.bought } : null,
        file_ids: fileIds,
      });
      setMessage({ ok: true, text: "A test is on its way to your account email." });
    } catch (err) {
      setMessage({ ok: false, text: err instanceof ApiError ? err.message : "The test didn't send. Try again." });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid gap-6 border-t border-line pt-5">
      <div className="grid gap-5 lg:grid-cols-2">
        <WorkPicker
          releases={releases}
          value={audience.works}
          onChange={(works) => setAudience({ ...audience, works })}
          legend="For buyers of"
          anyLabel="Any of my music"
          hint="Choose songs or releases to thank their buyers differently."
        />
        <div>
          <p className="text-[0.8125rem] font-semibold text-fg">Who</p>
          <div className="mt-2">
            <Segmented<MailWho> label="Who" value={audience.who} options={{ ALL: "Everyone", PRESALE: WHO_LABEL.PRESALE }} onChange={(who) => setAudience({ ...audience, who })} />
          </div>
          <p className="mt-3 text-sm text-fg-muted">If a purchase fits more than one thank-you, the most specific one is sent: chosen music before any music, pre-sale before everyone.</p>
        </div>
      </div>
      {offer ? (
        <div role="status" className="flex flex-wrap items-center gap-3 border border-line p-3 text-sm text-fg">
          <span>There are starting words written for {thankYouLabel(audience).toLowerCase()}.</span>
          <Button
            size="sm"
            variant="secondary"
            type="button"
            onClick={() => {
              setSubject(offer.subject);
              setBody(offer.body);
              lastStarter.current = `${offer.subject}\u0000${offer.body}`;
              setEdited(false);
              setOffer(null);
            }}
          >
            Use them instead of mine
          </Button>
          <Button size="sm" variant="ghost" type="button" onClick={() => setOffer(null)}>
            Keep mine
          </Button>
        </div>
      ) : null}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="grid content-start gap-4">
          {people.length ? (
            <label className="grid gap-1 text-[0.8125rem] font-semibold text-fg">
              Preview as
              <select className="cr-focus min-h-10 border border-line-strong bg-surface-sunken px-3 text-sm text-fg" value={person?.ref ?? ""} onChange={(e) => setPreviewRef(e.target.value)}>
                {people.slice(0, 500).map((p) => (
                  <option key={p.ref} value={p.ref}>
                    {p.name}
                    {p.bought.length ? ` (bought ${p.bought.join(", ")})` : ""}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p className="text-sm text-fg-muted">Nobody has bought this yet, so the preview uses a buyer without a name.</p>
          )}
          <RichEditor label="Subject" singleLine value={subject} onChange={typed(setSubject)} values={values} />
          <RichEditor label="Message" value={body} onChange={typed(setBody)} values={values} />
          {typos.length ? <p className="text-sm text-danger">{typos.join(", ")} won&apos;t be filled in. Use the buttons above the message.</p> : null}
        </div>
        <MailPreview artist={artist} subject={subject} body={body} values={values} kind="THANK_YOU" work={work} files={shared.files.filter((f) => fileIds.includes(f.id))} />
      </div>
      <FilesPicker profile={profile} files={shared.files} onFiles={shared.onFiles} value={fileIds} onChange={setFileIds} maxBytes={shared.fileMaxBytes} />
      <label className="flex items-center gap-2 text-sm font-semibold text-fg">
        <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} />
        Send this thank-you
      </label>
      {message ? (
        <p role={message.ok ? "status" : "alert"} className={`text-sm ${message.ok ? "text-fg" : "text-danger"}`}>
          {message.text}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="button" busy={busy === "save"} disabled={!subject.trim() || !body.trim()} onClick={() => void save()}>
          {start ? "Save changes" : "Save thank-you"}
        </Button>
        <Button type="button" variant="secondary" busy={busy === "test"} disabled={!subject.trim() || !body.trim()} onClick={() => void test()}>
          <Send aria-hidden="true" /> Send me a test
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Close
        </Button>
      </div>
    </div>
  );
}

export function ThankYouSection({ thankYous, onChanged, ...shared }: Shared & { thankYous: ThankYou[]; onChanged: () => void }) {
  // undefined: closed; null: a new one; otherwise the one being changed.
  const [editing, setEditing] = useState<ThankYou | null | undefined>(undefined);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function act(id: string, job: () => Promise<unknown>, text: string) {
    setBusy(id);
    try {
      await job();
      setNote(text);
      onChanged();
    } catch {
      setNote("That didn't go through. Try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card as="section" aria-labelledby={`thanks-${shared.profile.id}`} className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id={`thanks-${shared.profile.id}`} className="flex items-center gap-2 text-lg font-bold text-fg">
            <HeartHandshake aria-hidden="true" className="size-5 text-highlight" /> Thank-you emails
          </h3>
          <p className="mt-1 max-w-2xl text-sm text-fg-muted">
            Sent by Corner Room when someone buys your music, once per order. Thank pre-sale buyers or the buyers of one release in their own words; the most
            specific one that fits is sent. Changes go live as soon as you save.
          </p>
        </div>
        {editing === undefined ? (
          <Button size="sm" onClick={() => setEditing(null)}>
            <Plus aria-hidden="true" /> Add a thank-you
          </Button>
        ) : null}
      </div>
      {note ? (
        <p role="status" className="mt-3 text-sm text-fg">
          {note}
        </p>
      ) : null}
      {thankYous.length ? (
        <ul className="mt-4 grid gap-2">
          {thankYous.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-line py-2">
              <span className="min-w-0">
                <span className="block font-semibold text-fg">{thankYouLabel(t.audience)}</span>
                <span className="block text-sm text-fg-muted">
                  {t.on ? "On" : "Off"} · sent {t.sent_count} {t.sent_count === 1 ? "time" : "times"}
                  {t.sent_count ? ` · ${t.people_clicked} ${t.people_clicked === 1 ? "person" : "people"} clicked a link` : ""}
                </span>
              </span>
              <span className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-2 text-sm text-fg">
                  <input
                    type="checkbox"
                    role="switch"
                    aria-label={`Send the thank-you for ${thankYouLabel(t.audience)}`}
                    checked={t.on}
                    disabled={busy === t.id}
                    onChange={(e) => void act(t.id, () => updateThankYou(t.id, { on: e.target.checked }), e.target.checked ? "Switched on." : "Switched off.")}
                  />
                  Send
                </label>
                <Button size="sm" variant="secondary" onClick={() => setEditing(t)}>
                  <PenLine aria-hidden="true" /> Edit
                </Button>
                <Button size="sm" variant="ghost" aria-label={`Delete the thank-you for ${thankYouLabel(t.audience)}`} disabled={busy === t.id} onClick={() => void act(t.id, () => deleteThankYou(t.id), "Thank-you deleted.")}>
                  <Trash2 aria-hidden="true" />
                </Button>
              </span>
            </li>
          ))}
        </ul>
      ) : editing === undefined ? (
        <p className="mt-4 text-sm text-fg">No thank-you yet. Add one and every buyer hears from you in your own words.</p>
      ) : null}
      {editing !== undefined ? (
        <div className="mt-5">
          <ThankYouEditor
            key={editing?.id ?? "new"}
            {...shared}
            start={editing}
            onCancel={() => setEditing(undefined)}
            onDone={(text) => {
              setEditing(undefined);
              setNote(text);
              onChanged();
            }}
          />
        </div>
      ) : null}
    </Card>
  );
}
