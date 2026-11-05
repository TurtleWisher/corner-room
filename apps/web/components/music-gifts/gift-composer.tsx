"use client";

/*
 * Set up a music gift (owner, 2026-11-06, D-GIFT-MUSIC-01): a name only the act sees, the released
 * music to give, who it is for, the email that tells them (fill-ins show each person's own words in
 * the preview, with their personal note), files or links to give with it, and when it goes. Nothing
 * is given until Corner Room approves it; the server gives the music and sends every email.
 */

import { FormEvent, useMemo, useState } from "react";
import { CalendarClock, Gift, Save, Send, SendHorizontal } from "lucide-react";

import { FilesPicker } from "@/components/artist-mail/files-picker";
import { MailPreview } from "@/components/artist-mail/mail-preview";
import { RichEditor } from "@/components/artist-mail/rich-editor";
import { WorkPicker } from "@/components/artist-mail/work-picker";
import { Button, Field, Input } from "@/components/ds";
import { PeopleEditor } from "@/components/music-gifts/people-editor";
import type { MailFile, MailProfile } from "@/features/artist-mail/api";
import {
  createMusicGift,
  sendMusicGiftTest,
  submitMusicGift,
  updateMusicGift,
  type GiftSuggestion,
  type MusicGiftDetail,
  type MusicGiftWork,
  type PersonInput,
} from "@/features/music-gifts/api";
import type { ReleaseCard } from "@/features/studio/api";
import { ApiError } from "@/lib/api/client";
import type { Voice } from "@/lib/artist-mail-starters";
import { fromLocalInput, toLocalInput, unfilledMarks, unknownFillIns, valuesFor } from "@/lib/artist-mail-view";
import { GIFT_FILL_INS, giftStarter, missingParts } from "@/lib/music-gift-view";

export function GiftComposer({
  profile,
  artist,
  voice,
  releases,
  files,
  onFiles,
  fileMaxBytes,
  suggestions,
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
  suggestions: GiftSuggestion[];
  /** A draft to keep working on; none for a new gift. */
  start: MusicGiftDetail | null;
  onDone: (note: string, giftId: string) => void;
}) {
  const first = giftStarter(voice);
  const [draftId, setDraftId] = useState<string | null>(start?.id ?? null);
  const [title, setTitle] = useState(start?.title ?? "");
  const [works, setWorks] = useState<MusicGiftWork[]>(start?.works ?? []);
  const [people, setPeople] = useState<PersonInput[]>(start?.people.map(({ email, name, note }) => ({ email, name, note })) ?? []);
  const [buyerRefs, setBuyerRefs] = useState<string[]>([]);
  const [subject, setSubject] = useState(start?.subject || first.subject);
  const [body, setBody] = useState(start?.body || first.body);
  const [fileIds, setFileIds] = useState<string[]>(start?.file_ids ?? []);
  const [later, setLater] = useState(Boolean(start?.send_at));
  const [sendAt, setSendAt] = useState(toLocalInput(start?.send_at));
  const [previewAt, setPreviewAt] = useState(0);
  const [noAccount, setNoAccount] = useState(false);
  const [busy, setBusy] = useState<"draft" | "send" | "test" | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const titles = works.map((w) => w.title ?? "");
  const person = people[Math.min(previewAt, Math.max(people.length - 1, 0))] ?? null;
  const values = useMemo(() => valuesFor(person?.name ?? null, titles, artist), [person?.name, titles.join("\u0000"), artist]); // eslint-disable-line react-hooks/exhaustive-deps
  const marks = unfilledMarks(subject + "\n" + body);
  const typos = unknownFillIns(subject + "\n" + body);
  const sendAtIso = later ? fromLocalInput(sendAt) : null;
  const missing = missingParts({ works, people: [...people, ...buyerRefs], subject, body });
  const ready = !missing.length && !marks.length && (!later || Boolean(sendAtIso));

  const payload = () => ({
    title: title.trim() || "Music gift",
    works,
    subject,
    body,
    file_ids: fileIds,
    send_at: sendAtIso,
    people,
    buyer_refs: buyerRefs,
  });

  async function save(): Promise<MusicGiftDetail> {
    const saved = draftId ? await updateMusicGift(draftId, payload()) : await createMusicGift(profile.kind, profile.id, payload());
    setDraftId(saved.id);
    // Buyers added by name are on the saved list now, with their address kept by the server.
    setPeople(saved.people.map(({ email, name, note }) => ({ email, name, note })));
    setBuyerRefs([]);
    return saved;
  }

  async function run(kind: "draft" | "send" | "test", job: () => Promise<{ note: string; id: string; done: boolean }>) {
    setBusy(kind);
    setMessage(null);
    try {
      const result = await job();
      if (result.done) onDone(result.note, result.id);
      else setMessage({ ok: true, text: result.note });
    } catch (err) {
      setMessage({ ok: false, text: err instanceof ApiError ? err.message : "That didn't go through. Try again." });
    } finally {
      setBusy(null);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    void run("send", async () => {
      const saved = await save();
      await submitMusicGift(saved.id);
      return {
        note: sendAtIso
          ? "Sent to Corner Room. Once approved, the music is given at the time you chose."
          : "Sent to Corner Room. The music is given and the emails go as soon as it is approved.",
        id: saved.id,
        done: true,
      };
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-7">
      <div className="grid gap-2 sm:max-w-md">
        <Field label="Name for this gift" hint="Only you and Corner Room see it, like “Radio friends” or “Crew”.">
          {(c) => <Input {...c} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="Music gift" />}
        </Field>
      </div>

      <WorkPicker
        releases={releases}
        value={works}
        onChange={setWorks}
        legend="The music you're giving"
        hint="Whole releases, or songs on them. Only music that is out can be given."
        statuses={["RELEASED"]}
        emptyText="Nothing of yours is out yet. Music can be given once it is released."
      />

      <PeopleEditor value={people} onChange={setPeople} suggestions={suggestions} buyerRefs={buyerRefs} onBuyerRefs={setBuyerRefs} />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="grid content-start gap-4">
          <p className="flex items-center gap-2 text-[0.8125rem] font-semibold text-fg">
            <Gift aria-hidden="true" className="size-4 text-highlight" /> The email that tells them
          </p>
          {people.length ? (
            <label className="grid gap-1 text-[0.8125rem] font-semibold text-fg">
              Preview as
              <select
                className="cr-focus min-h-10 border border-line-strong bg-surface-sunken px-3 text-sm text-fg"
                value={Math.min(previewAt, people.length - 1)}
                onChange={(e) => setPreviewAt(Number(e.target.value))}
              >
                {people.slice(0, 500).map((p, i) => (
                  <option key={p.email} value={i}>
                    {p.name ? `${p.name} (${p.email})` : p.email}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="flex items-center gap-2 text-sm text-fg">
            <input type="checkbox" checked={noAccount} onChange={(e) => setNoAccount(e.target.checked)} />
            Preview as someone without a Corner Room account yet
          </label>
          <RichEditor label="Subject" singleLine value={subject} onChange={setSubject} values={values} fillIns={GIFT_FILL_INS} placeholder="What the email says at the top" />
          <RichEditor label="Message" value={body} onChange={setBody} values={values} fillIns={GIFT_FILL_INS} placeholder="Say why you're giving it" />
          <p className="text-xs text-fg-muted">
            Highlighted words change for each person. A person&apos;s personal note goes under the message. Select words and tap Link to add a link. Write in any
            language.
          </p>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="justify-self-start"
            onClick={() => {
              setSubject(first.subject);
              setBody(first.body);
            }}
          >
            Start again from the suggested words
          </Button>
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
          kind="GIFT"
          work={works[0] ?? null}
          files={files.filter((f) => fileIds.includes(f.id))}
          note={person?.note ?? null}
          claimFor={noAccount ? (person?.email ?? "their email address") : null}
        />
      </div>

      <FilesPicker profile={profile} files={files} onFiles={onFiles} value={fileIds} onChange={setFileIds} maxBytes={fileMaxBytes} />

      <fieldset>
        <legend className="flex items-center gap-2 text-[0.8125rem] font-semibold text-fg">
          <CalendarClock aria-hidden="true" className="size-4 text-highlight" /> When it&apos;s given
        </legend>
        <div className="mt-2 grid gap-2 text-sm text-fg">
          <label className="flex items-center gap-2">
            <input type="radio" name={`gift-when-${profile.id}`} checked={!later} onChange={() => setLater(false)} />
            As soon as Corner Room approves it
          </label>
          <label className="flex flex-wrap items-center gap-2">
            <input type="radio" name={`gift-when-${profile.id}`} checked={later} onChange={() => setLater(true)} />
            At a time I choose (Bangladesh time)
            {later ? (
              <Input
                type="datetime-local"
                className="w-auto"
                value={sendAt}
                min={toLocalInput(new Date().toISOString())}
                onChange={(e) => setSendAt(e.target.value)}
                aria-label="Give at"
              />
            ) : null}
          </label>
        </div>
      </fieldset>

      {missing.length ? <p className="text-sm text-fg-muted">Before sending for review, add {missing.join(", ")}.</p> : null}
      {message ? (
        <p role={message.ok ? "status" : "alert"} className={`text-sm ${message.ok ? "text-fg" : "text-danger"}`}>
          {message.text}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" busy={busy === "send"} disabled={!ready}>
          <SendHorizontal aria-hidden="true" /> Send for review
        </Button>
        <Button
          variant="secondary"
          type="button"
          busy={busy === "draft"}
          onClick={() => void run("draft", async () => ({ note: "Draft saved.", id: (await save()).id, done: false }))}
        >
          <Save aria-hidden="true" /> Save draft
        </Button>
        <Button
          variant="secondary"
          type="button"
          busy={busy === "test"}
          disabled={!subject.trim() || !body.trim()}
          onClick={() =>
            void run("test", async () => {
              const saved = await save();
              await sendMusicGiftTest(saved.id);
              return { note: "Draft saved, and a test email is on its way to your account email.", id: saved.id, done: false };
            })
          }
        >
          <Send aria-hidden="true" /> Send me a test
        </Button>
      </div>
    </form>
  );
}
