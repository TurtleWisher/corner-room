"use client";

/*
 * Write an email to buyers (owner, 2026-11-02, D-MAIL-01 and D-MAIL-02). Pick an occasion and the
 * words are written for it, for who gets it and for what they bought; change the audience and the
 * words follow until you edit them yourself. Fill-ins show as the real words for the buyer you're
 * previewing as. Add links inside the text, files for a gift, and a time to send. Corner Room checks
 * every email before it goes; who gets it is worked out then (or at its time).
 */

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { BookmarkPlus, CalendarClock, Save, Send, SendHorizontal, Sparkles } from "lucide-react";

import { Button, Field, Input } from "@/components/ds";
import { AudienceBuilder } from "@/components/artist-mail/audience-builder";
import { FilesPicker } from "@/components/artist-mail/files-picker";
import { MailPreview } from "@/components/artist-mail/mail-preview";
import { RichEditor } from "@/components/artist-mail/rich-editor";
import { releaseTypes } from "@/components/artist-mail/work-picker";
import {
  createMail,
  createMailTemplate,
  fullAudience,
  sendTestMail,
  submitMail,
  updateMail,
  updateMailTemplate,
  type ArtistMail,
  type MailAudience,
  type MailFile,
  type MailPerson,
  type MailProfile,
  type MailTemplate,
  type Occasion,
} from "@/features/artist-mail/api";
import type { ReleaseCard } from "@/features/studio/api";
import { ApiError } from "@/lib/api/client";
import { OCCASION_LABEL, OCCASIONS, occasionStarter, shapeOf, type Voice } from "@/lib/artist-mail-starters";
import { fromLocalInput, previewValues, reachOf, readyToSend, toLocalInput, unfilledMarks, unknownFillIns } from "@/lib/artist-mail-view";

export type ComposerStart = { draft?: ArtistMail; template?: MailTemplate } | null;

export function MailComposer({
  profile,
  artist,
  voice,
  releases,
  files,
  onFiles,
  fileMaxBytes,
  start,
  onDone,
}: {
  profile: MailProfile;
  artist: string;
  voice: Voice;
  releases: ReleaseCard[];
  files: MailFile[];
  onFiles: (files: MailFile[]) => void;
  fileMaxBytes: number;
  start: ComposerStart;
  onDone: (note: string) => void;
}) {
  const source = start?.draft ?? start?.template ?? null;
  const first = source ? null : occasionStarter("NOTE", "ALL", { kind: "any" }, voice);
  const [occasion, setOccasion] = useState<Occasion>(source?.occasion ?? "NOTE");
  const [audience, setAudience] = useState<MailAudience>(fullAudience(source?.audience));
  const [subject, setSubject] = useState(source?.subject ?? first?.subject ?? "");
  const [body, setBody] = useState(source?.body ?? first?.body ?? "");
  const [edited, setEdited] = useState(Boolean(source));
  const [people, setPeople] = useState<MailPerson[]>([]);
  const [previewRef, setPreviewRef] = useState<string | null>(null);
  const [fileIds, setFileIds] = useState<string[]>(source?.file_ids ?? []);
  const [later, setLater] = useState(Boolean(start?.draft?.send_at));
  const [sendAt, setSendAt] = useState(toLocalInput(start?.draft?.send_at));
  const [templateName, setTemplateName] = useState(start?.template?.name ?? "");
  const [busy, setBusy] = useState<"draft" | "send" | "template" | "test" | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [offer, setOffer] = useState<{ subject: string; body: string } | null>(null);

  const types = useMemo(() => releaseTypes(releases), [releases]);
  const shape = shapeOf(audience.works, types);
  const starter = occasionStarter(occasion, audience.who, shape, voice);

  // While the words are still the starting ones, they follow the occasion, audience and music.
  const lastStarter = useRef(`${subject}\u0000${body}`);
  const mounted = useRef(false);
  useEffect(() => {
    const next = `${starter.subject}\u0000${starter.body}`;
    if (!mounted.current) {
      // A saved draft or template opens with its own words, not an offer to replace them.
      mounted.current = true;
      if (source) return;
    }
    if (next === lastStarter.current) return;
    if (!edited) {
      setSubject(starter.subject);
      setBody(starter.body);
      lastStarter.current = next;
      setOffer(null);
    } else {
      setOffer(starter);
    }
    // starter is derived from these.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [occasion, audience.who, shape.kind, voice, JSON.stringify(shape)]);

  const reachable = people.filter((p) => !p.stopped && reachOf([p], audience.pick).count === 1);
  const previewPerson = reachable.find((p) => p.ref === previewRef) ?? reachable[0] ?? null;
  const chosenTitles = audience.works.map((w) => w.title ?? "");
  const values = previewValues(previewPerson, chosenTitles, artist);
  const previewWork = audience.works.find((w) => previewPerson?.bought.includes(w.title ?? "")) ?? audience.works[0] ?? null;
  const reach = reachOf(people, audience.pick);
  const marks = unfilledMarks(subject + "\n" + body);
  const typos = unknownFillIns(subject + "\n" + body);
  const sendAtIso = later ? fromLocalInput(sendAt) : null;
  const ready = readyToSend({ subject, body, audience }) && !marks.length && (!later || Boolean(sendAtIso));

  const payload = () => ({ subject, body, audience, send_at: sendAtIso, occasion, file_ids: fileIds });
  const save = () => (start?.draft ? updateMail(start.draft.id, payload()) : createMail(profile, payload()));

  async function run(kind: "draft" | "send" | "template" | "test", job: () => Promise<string>) {
    setBusy(kind);
    setMessage(null);
    try {
      const note = await job();
      if (kind === "test" || kind === "template") setMessage({ ok: true, text: note });
      else onDone(note);
    } catch (err) {
      setMessage({ ok: false, text: err instanceof ApiError ? err.message : "That didn't go through. Try again." });
    } finally {
      setBusy(null);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    void run("send", async () => {
      const draft = await save();
      await submitMail(draft.id);
      return sendAtIso ? "Sent to Corner Room. Once approved it goes at the time you chose." : "Sent to Corner Room. It goes out once it is approved.";
    });
  }

  const typed = (setter: (v: string) => void) => (v: string) => {
    setter(v);
    setEdited(true);
  };

  return (
    <form onSubmit={submit} className="grid gap-6">
      <fieldset>
        <legend className="flex items-center gap-2 text-[0.8125rem] font-semibold text-fg">
          <Sparkles aria-hidden="true" className="size-4 text-highlight" /> What it&apos;s about
        </legend>
        <p className="mt-1 text-sm text-fg-muted">Pick one and the words are written for it. They follow who gets it and what they bought until you change them.</p>
        <div className="am-chips mt-2">
          {OCCASIONS.map((o) => (
            <button
              key={o}
              type="button"
              aria-pressed={occasion === o}
              className="am-occasion cr-focus"
              onClick={() => {
                setOccasion(o);
              }}
            >
              {OCCASION_LABEL[o]}
            </button>
          ))}
        </div>
      </fieldset>

      <AudienceBuilder profile={profile} releases={releases} value={audience} onChange={setAudience} onPeople={setPeople} />

      {offer ? (
        <div role="status" className="flex flex-wrap items-center gap-3 border border-line p-3 text-sm text-fg">
          <span>There are starting words for {OCCASION_LABEL[occasion].toLowerCase()} written for this audience.</span>
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
          {reachable.length ? (
            <label className="grid gap-1 text-[0.8125rem] font-semibold text-fg">
              Preview as
              <select
                className="cr-focus min-h-10 border border-line-strong bg-surface-sunken px-3 text-sm text-fg"
                value={previewPerson?.ref ?? ""}
                onChange={(e) => setPreviewRef(e.target.value)}
              >
                {reachable.slice(0, 500).map((p) => (
                  <option key={p.ref} value={p.ref}>
                    {p.name}
                    {p.bought.length ? ` (bought ${p.bought.join(", ")})` : ""}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <RichEditor label="Subject" singleLine value={subject} onChange={typed(setSubject)} values={values} placeholder="What the email is about" />
          <RichEditor label="Message" value={body} onChange={typed(setBody)} values={values} placeholder="Write to your buyers" />
          <p className="text-xs text-fg-muted">
            Highlighted words change for each person. Select words and tap Link to add a link. Write in any language.
          </p>
          {marks.length ? (
            <p role="alert" className="text-sm text-danger">
              Fill in {marks.join(", ")} before sending.
            </p>
          ) : null}
          {typos.length ? <p className="text-sm text-danger">{typos.join(", ")} won&apos;t be filled in. Use the buttons above the message.</p> : null}
        </div>
        <MailPreview
          artist={artist}
          subject={subject}
          body={body}
          values={values}
          kind="MANUAL"
          work={previewWork}
          files={files.filter((f) => fileIds.includes(f.id))}
        />
      </div>

      <FilesPicker profile={profile} files={files} onFiles={onFiles} value={fileIds} onChange={setFileIds} maxBytes={fileMaxBytes} />

      <fieldset>
        <legend className="flex items-center gap-2 text-[0.8125rem] font-semibold text-fg">
          <CalendarClock aria-hidden="true" className="size-4 text-highlight" /> When it goes
        </legend>
        <div className="mt-2 grid gap-2 text-sm text-fg">
          <label className="flex items-center gap-2">
            <input type="radio" name={`when-${profile.id}`} checked={!later} onChange={() => setLater(false)} />
            As soon as Corner Room approves it
          </label>
          <label className="flex flex-wrap items-center gap-2">
            <input type="radio" name={`when-${profile.id}`} checked={later} onChange={() => setLater(true)} />
            At a time I choose (Bangladesh time)
            {later ? (
              <Input
                type="datetime-local"
                className="w-auto"
                value={sendAt}
                min={toLocalInput(new Date().toISOString())}
                onChange={(e) => setSendAt(e.target.value)}
                aria-label="Send at"
              />
            ) : null}
          </label>
          {later ? <p className="text-xs text-fg-muted">Who gets it is worked out at that time, so new buyers who fit are included.</p> : null}
        </div>
      </fieldset>

      <div className="grid gap-2 sm:max-w-md">
        <Field label="Template name" hint="To keep this email, its audience and files for next time">
          {(c) => <Input {...c} value={templateName} onChange={(e) => setTemplateName(e.target.value)} maxLength={120} />}
        </Field>
      </div>
      {message ? (
        <p role={message.ok ? "status" : "alert"} className={`text-sm ${message.ok ? "text-fg" : "text-danger"}`}>
          {message.text}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" busy={busy === "send"} disabled={!ready || reach.count === 0}>
          <SendHorizontal aria-hidden="true" /> Send for review
        </Button>
        <Button
          variant="secondary"
          type="button"
          busy={busy === "draft"}
          disabled={!subject.trim() || !body.trim() || audience.works.length === 0}
          onClick={() => void run("draft", async () => (await save(), "Draft saved."))}
        >
          <Save aria-hidden="true" /> Save draft
        </Button>
        <Button
          variant="secondary"
          type="button"
          busy={busy === "template"}
          disabled={!subject.trim() || !body.trim() || audience.works.length === 0 || !templateName.trim()}
          onClick={() =>
            void run("template", async () => {
              const t = { name: templateName, subject, body, audience, occasion, file_ids: fileIds };
              await (start?.template ? updateMailTemplate(start.template.id, t) : createMailTemplate(profile, t));
              return `Template "${templateName.trim()}" saved.`;
            })
          }
        >
          <BookmarkPlus aria-hidden="true" /> {start?.template ? "Update template" : "Save as template"}
        </Button>
        <Button
          variant="ghost"
          type="button"
          busy={busy === "test"}
          disabled={!subject.trim() || !body.trim()}
          onClick={() =>
            void run("test", async () => {
              await sendTestMail(profile, {
                kind: "MANUAL",
                subject,
                body,
                works: previewWork ? [previewWork] : [],
                preview: previewPerson ? { name: previewPerson.has_name ? previewPerson.name : null, music: previewPerson.bought } : null,
                file_ids: fileIds,
              });
              return `A test${previewPerson ? `, written as ${previewPerson.name} will see it,` : ""} is on its way to your account email.`;
            })
          }
        >
          <Send aria-hidden="true" /> Send me a test
        </Button>
      </div>
    </form>
  );
}
