"use client";

/*
 * Write an email to buyers (owner, 2026-11-02, D-MAIL-01): subject, message and who gets it: the
 * buyers of chosen songs and releases, all of them, pre-sale buyers only, or people picked by name
 * (names only, D-BUYERS-01). Corner Room checks every email before it goes; who gets it is worked
 * out when it is approved. Save it as a draft or a template to use again.
 */

import { FormEvent, useEffect, useMemo, useState } from "react";
import { BookmarkPlus, Save, Search, Send, SendHorizontal } from "lucide-react";

import { Button, Field, Input } from "@/components/ds";
import { Textarea } from "@/components/ds/input";
import { MailPreview } from "@/components/artist-mail/mail-preview";
import { ReleaseChoice } from "@/components/gifts/campaign-form";
import { useAsync } from "@/components/use-async";
import {
  createMail,
  createMailTemplate,
  fetchMailBuyers,
  fetchReach,
  sendTestMail,
  submitMail,
  updateMail,
  updateMailTemplate,
  type ArtistMail,
  type MailAudience,
  type MailProfile,
  type MailTemplate,
  type MailWho,
  type MailWork,
  type Reach,
} from "@/features/artist-mail/api";
import { fetchProfileReleases } from "@/features/studio/api";
import { ApiError } from "@/lib/api/client";
import { FILL_INS, reachLine, readyToSend, togglePicked, WHO_LABEL } from "@/lib/artist-mail-view";

const key = (w: MailWork) => `${w.type}:${w.id}`;

export type ComposerStart = { draft?: ArtistMail; template?: MailTemplate } | null;

function BuyerPicker({ profile, works, picked, onChange }: { profile: MailProfile; works: MailWork[]; picked: string[]; onChange: (p: string[]) => void }) {
  const worksKey = works.map(key).sort().join(",");
  const buyers = useAsync(() => (works.length ? fetchMailBuyers(profile, works) : Promise.resolve([])), [profile.kind, profile.id, worksKey]);
  const [query, setQuery] = useState("");
  if (!works.length) return <p className="text-sm text-fg-muted">Choose the music first to see who bought it.</p>;
  if (buyers.status === "loading") return <p className="text-sm text-fg-muted">Loading buyers</p>;
  if (buyers.status === "error") return <p className="text-sm text-danger">Buyers couldn&apos;t be loaded.</p>;
  if (buyers.data.length === 0) return <p className="text-sm text-fg">Nobody has bought this music yet.</p>;
  const shown = buyers.data.filter((b) => b.name.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <div className="grid gap-2">
      <label className="relative block">
        <span className="sr-only">Find a buyer</span>
        <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-muted" />
        <Input className="pl-9" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a buyer" />
      </label>
      <p className="text-xs text-fg-muted">
        {picked.length} of {buyers.data.length} picked. You see names only; Corner Room sends the email.
      </p>
      <ul className="max-h-64 overflow-y-auto border-y border-line">
        {shown.map((b) => (
          <li key={b.ref}>
            <label className="flex items-center gap-2 py-1.5 text-sm text-fg">
              <input type="checkbox" checked={picked.includes(b.ref)} onChange={() => onChange(togglePicked(picked, b.ref))} />
              {b.name}
              {b.presale ? <span className="text-xs font-semibold text-highlight">Pre-sale</span> : null}
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function MailComposer({
  profile,
  artist,
  start,
  onDone,
}: {
  profile: MailProfile;
  artist: string;
  start: ComposerStart;
  onDone: (note: string) => void;
}) {
  const source = start?.draft ?? start?.template ?? null;
  const releases = useAsync(() => fetchProfileReleases(profile.kind, profile.id), [profile.kind, profile.id]);
  const [subject, setSubject] = useState(source?.subject ?? "");
  const [body, setBody] = useState(source?.body ?? "");
  const [works, setWorks] = useState<MailWork[]>(source?.audience.works.map((w) => ({ type: w.type, id: w.id, title: w.title })) ?? []);
  const [who, setWho] = useState<MailWho>(source?.audience.who ?? "ALL");
  const [picked, setPicked] = useState<string[]>(source?.audience.picked ?? []);
  const [templateName, setTemplateName] = useState(start?.template?.name ?? "");
  const [reach, setReach] = useState<Reach | null>(null);
  const [busy, setBusy] = useState<"draft" | "send" | "template" | "test" | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const chosen = new Set(works.map(key));
  const audience: MailAudience = useMemo(() => ({ works, who, picked }), [works, who, picked]);
  const ready = readyToSend({ subject, body, audience });

  const { kind: profileKind, id: profileId } = profile;
  useEffect(() => {
    setReach(null);
    if (!audience.works.length || (audience.who === "PICKED" && !audience.picked.length)) return;
    let live = true;
    const timer = window.setTimeout(() => {
      fetchReach({ kind: profileKind, id: profileId }, audience)
        .then((r) => live && setReach(r))
        .catch(() => live && setReach(null));
    }, 300);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [profileKind, profileId, audience]);

  const toggle = (w: MailWork) => {
    setWorks((list) => (list.some((x) => key(x) === key(w)) ? list.filter((x) => key(x) !== key(w)) : [...list, w]));
    setPicked([]);
  };

  async function run(kind: "draft" | "send" | "template" | "test", job: () => Promise<string>) {
    setBusy(kind);
    setMessage(null);
    try {
      const note = await job();
      if (kind === "test") setMessage({ ok: true, text: note });
      else onDone(note);
    } catch (err) {
      setMessage({ ok: false, text: err instanceof ApiError ? err.message : "That didn't go through. Try again." });
    } finally {
      setBusy(null);
    }
  }

  const save = () => (start?.draft ? updateMail(start.draft.id, { subject, body, audience }) : createMail(profile, { subject, body, audience }));

  function submit(e: FormEvent) {
    e.preventDefault();
    void run("send", async () => {
      const draft = await save();
      await submitMail(draft.id);
      return "Sent to Corner Room. It goes out once it is approved.";
    });
  }

  const music = releases.status === "ok" ? releases.data.filter((r) => ["APPROVED", "SCHEDULED", "RELEASED"].includes(r.status)) : [];
  return (
    <form onSubmit={submit} className="grid gap-5">
      <fieldset>
        <legend className="text-[0.8125rem] font-semibold text-fg">Which music</legend>
        <p className="mt-1 text-sm text-fg-muted">The email goes to people who bought what you tick. Buying an album counts for each of its songs.</p>
        {releases.status === "loading" ? (
          <p className="mt-2 text-sm text-fg-muted">Loading your music</p>
        ) : music.length === 0 ? (
          <p className="mt-2 text-sm text-fg">No approved or released music yet.</p>
        ) : (
          <ul className="mt-2 border-t border-line">
            {music.map((r) => (
              <ReleaseChoice key={r.id} release={r} chosen={chosen} toggle={(w) => toggle({ ...w, title: w.type === "RELEASE" ? r.title : undefined })} />
            ))}
          </ul>
        )}
      </fieldset>
      <fieldset>
        <legend className="text-[0.8125rem] font-semibold text-fg">Who gets it</legend>
        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
          {(Object.keys(WHO_LABEL) as MailWho[]).map((w) => (
            <label key={w} className="flex items-center gap-2 text-sm text-fg">
              <input type="radio" name={`who-${profile.id}`} checked={who === w} onChange={() => setWho(w)} />
              {WHO_LABEL[w]}
            </label>
          ))}
        </div>
        {who === "PICKED" ? (
          <div className="mt-3">
            <BuyerPicker profile={profile} works={works} picked={picked} onChange={setPicked} />
          </div>
        ) : null}
        <p className="mt-3 text-sm font-semibold text-fg" aria-live="polite">
          {works.length ? reachLine(reach) : "Choose the music to see how many people it reaches"}
        </p>
      </fieldset>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="grid content-start gap-4">
          <Field label="Subject" required>
            {(c) => <Input {...c} value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} />}
          </Field>
          <Field label="Message" required hint="Plain text. Links work. Write in any language.">
            {(c) => <Textarea {...c} value={body} onChange={(e) => setBody(e.target.value)} maxLength={10000} rows={10} />}
          </Field>
          <p className="text-xs text-fg-muted">Fill-ins: {FILL_INS.map((f) => `{${f.key}} ${f.label.toLowerCase()}`).join(" · ")}</p>
        </div>
        <MailPreview artist={artist} subject={subject} body={body} kind="MANUAL" />
      </div>
      <div className="grid gap-2 sm:max-w-md">
        <Field label="Template name" hint="To save this email and its audience to use again">
          {(c) => <Input {...c} value={templateName} onChange={(e) => setTemplateName(e.target.value)} maxLength={120} />}
        </Field>
      </div>
      {message ? (
        <p role={message.ok ? "status" : "alert"} className={`text-sm ${message.ok ? "text-fg" : "text-danger"}`}>
          {message.text}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" busy={busy === "send"} disabled={!ready || reach?.count === 0}>
          <SendHorizontal aria-hidden="true" /> Send for review
        </Button>
        <Button
          variant="secondary"
          busy={busy === "draft"}
          disabled={!ready}
          onClick={() => void run("draft", async () => (await save(), "Draft saved."))}
        >
          <Save aria-hidden="true" /> Save draft
        </Button>
        <Button
          variant="secondary"
          busy={busy === "template"}
          disabled={!ready || !templateName.trim()}
          onClick={() =>
            void run("template", async () => {
              const t = { name: templateName, subject, body, audience };
              await (start?.template ? updateMailTemplate(start.template.id, t) : createMailTemplate(profile, t));
              return `Template "${templateName.trim()}" saved.`;
            })
          }
        >
          <BookmarkPlus aria-hidden="true" /> {start?.template ? "Update template" : "Save as template"}
        </Button>
        <Button
          variant="ghost"
          busy={busy === "test"}
          disabled={!subject.trim() || !body.trim()}
          onClick={() =>
            void run("test", async () => {
              await sendTestMail(profile, { kind: "MANUAL", subject, body });
              return "A test is on its way to your account email.";
            })
          }
        >
          <Send aria-hidden="true" /> Send me a test
        </Button>
      </div>
    </form>
  );
}
