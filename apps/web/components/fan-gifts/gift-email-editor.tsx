"use client";

/*
 * The gift email a giver designs (owner, 2026-11-20, D-GIFT-FAN-02): a message with the artist
 * editor's fill-ins and links, an optional subject, one of three looks, the cover on or off, and
 * up to five pictures or PDFs. Beside it, the email exactly as each person will get it, written by
 * the server (`POST /fan-gifts/preview`) and drawn by EmailFrame; pictures show from the giver's
 * own copies on this device.
 * Corner Room checks everything written or attached before anyone is emailed.
 */

import { useEffect, useRef, useState } from "react";
import { FileText, ImageIcon, Paperclip, ShieldCheck, Trash2 } from "lucide-react";

import { RichEditor } from "@/components/artist-mail/rich-editor";
import { EmailFrame } from "@/components/fan-gifts/email-frame";
import { Button, Field, Input, Select } from "@/components/ds";
import { deleteGiftFile, fetchMyGiftFile, previewGiftEmail, uploadGiftFile, type GiftDesign, type GiftFile, type GiftPerson, type GiftPreview } from "@/features/fan-gifts/api";
import { friendlyError } from "@/lib/error-copy";
import {
  FILE_ACCEPT,
  FILES_MAX,
  fileProblem,
  GIFT_FILL_INS,
  LOOKS,
  noteProblem,
  previewPeople,
  SUBJECT_MAX,
  subjectProblem,
} from "@/lib/fan-gift-view";
import type { MailValues } from "@/lib/artist-mail-view";

export const NO_DESIGN: GiftDesign = { note: "", subject: "", look: "SKY", show_cover: true, file_ids: [] };

type Local = GiftFile & { url: string };

export function GiftEmailEditor({
  offerId,
  title,
  people,
  design,
  onChange,
  seedFiles,
}: {
  offerId: string;
  /** The song or release, for the {music} fill-in. */
  title: string;
  people: GiftPerson[];
  design: GiftDesign;
  onChange: (next: GiftDesign) => void;
  /** Files already attached (a gift sent again): shown and previewed like new ones. */
  seedFiles?: GiftFile[];
}) {
  const [files, setFiles] = useState<Local[]>([]);
  const [uploading, setUploading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [who, setWho] = useState(0);
  const [preview, setPreview] = useState<GiftPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const choices = previewPeople(people);
  const person = choices[Math.min(who, choices.length - 1)];
  const values = { first_name: (person.name ?? "").split(/\s+/)[0] || "there", music: title, buyer_name: person.name ?? "", artist: "" } as MailValues;

  // The server writes the preview; ask again a moment after typing stops.
  const ask = JSON.stringify([offerId, design, person.name]);
  useEffect(() => {
    let live = true;
    const t = window.setTimeout(() => {
      previewGiftEmail(offerId, design, person.name)
        .then((p) => {
          if (!live) return;
          setPreview(p);
          setPreviewError(null);
        })
        .catch((err) => live && setPreviewError(friendlyError(err, "The preview couldn't be drawn.")));
    }, 400);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
    // `ask` stands for everything the preview depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ask]);

  // Free this page's picture copies when it goes.
  const urls = useRef<string[]>([]);

  // A gift sent again brings its files: fetch each once so the list and the preview show it.
  const seeded = useRef(new Set<string>());
  useEffect(() => {
    for (const f of seedFiles ?? []) {
      if (seeded.current.has(f.id)) continue;
      seeded.current.add(f.id);
      void fetchMyGiftFile(f.id).then((blob) => {
        const url = blob ? URL.createObjectURL(blob) : "";
        if (url) urls.current.push(url);
        setFiles((now) => (now.some((x) => x.id === f.id) ? now : [...now, { ...f, url }]));
      });
    }
  }, [seedFiles]);
  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);

  async function attach(list: FileList | null) {
    const file = list?.[0];
    if (!file) return;
    const problem = fileProblem(file, design.file_ids.length);
    if (problem) {
      setFileError(problem);
      return;
    }
    setUploading(true);
    setFileError(null);
    try {
      const saved = await uploadGiftFile(file);
      const url = URL.createObjectURL(file);
      urls.current.push(url);
      setFiles((now) => [...now, { ...saved, url }]);
      onChange({ ...design, file_ids: [...design.file_ids, saved.id] });
    } catch (err) {
      setFileError(friendlyError(err, "That file couldn't be attached."));
    } finally {
      setUploading(false);
      if (input.current) input.current.value = "";
    }
  }

  async function remove(id: string) {
    onChange({ ...design, file_ids: design.file_ids.filter((f) => f !== id) });
    setFiles((now) => now.filter((f) => f.id !== id));
    await deleteGiftFile(id).catch(() => undefined);
  }

  const pictures = Object.fromEntries(files.map((f) => [f.id, f.url]));
  const shown = files.filter((f) => design.file_ids.includes(f.id));
  const wrote = Boolean(design.note.trim() || design.subject.trim() || design.file_ids.length);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="grid content-start gap-4">
        <Field label="Subject (optional)" hint={`Leave it empty for "${title}" as a gift from you. Up to ${SUBJECT_MAX} characters.`} error={subjectProblem(design.subject) ?? undefined}>
          {(c) => <Input {...c} value={design.subject} maxLength={SUBJECT_MAX + 20} onChange={(e) => onChange({ ...design, subject: e.target.value })} />}
        </Field>
        <div>
          <RichEditor
            label="Your message"
            value={design.note}
            onChange={(note) => onChange({ ...design, note })}
            values={values}
            fillIns={GIFT_FILL_INS}
            placeholder="Write something for them. Add their first name, and links to anything you like."
            invalid={Boolean(noteProblem(design.note))}
          />
          {noteProblem(design.note) ? <p className="mt-1 text-sm text-danger">{noteProblem(design.note)}</p> : null}
        </div>
        <fieldset>
          <legend className="text-sm font-semibold text-fg">Look</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {LOOKS.map((l) => (
              <label key={l.key} className="flex cursor-pointer items-center gap-2 border border-line px-3 py-2 text-sm has-[:checked]:border-highlight has-[:checked]:text-fg">
                <input type="radio" name="gift-look" className="sr-only" checked={design.look === l.key} onChange={() => onChange({ ...design, look: l.key })} />
                <span aria-hidden="true" className="inline-flex size-5 overflow-hidden rounded-full border border-line">
                  <span className="w-1/2" style={{ background: l.swatch[1] }} />
                  <span className="w-1/2" style={{ background: l.swatch[0] }} />
                </span>
                {l.label}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="flex cursor-pointer items-center gap-3 text-sm text-fg">
          <input type="checkbox" className="size-4 accent-[var(--color-highlight)]" checked={design.show_cover} onChange={(e) => onChange({ ...design, show_cover: e.target.checked })} />
          Show the cover at the top
        </label>
        <div>
          <p className="text-sm font-semibold text-fg">Pictures and PDFs</p>
          <p className="text-xs text-fg-muted">Up to {FILES_MAX}. Pictures show in the email; PDFs are a download.</p>
          {shown.length ? (
            <ul className="mt-2 grid gap-1.5">
              {shown.map((f) => (
                <li key={f.id} className="flex items-center justify-between gap-2 border border-line px-3 py-1.5 text-sm">
                  <span className="flex min-w-0 items-center gap-2 truncate text-fg">
                    {f.kind === "IMAGE" ? <ImageIcon aria-hidden="true" className="size-4 shrink-0" /> : <FileText aria-hidden="true" className="size-4 shrink-0" />}
                    <span className="truncate">{f.name}</span>
                  </span>
                  <button type="button" className="cr-focus text-fg-muted hover:text-fg" aria-label={`Remove ${f.name}`} onClick={() => void remove(f.id)}>
                    <Trash2 aria-hidden="true" className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <input ref={input} type="file" accept={FILE_ACCEPT} className="sr-only" aria-label="Attach a picture or PDF" onChange={(e) => void attach(e.target.files)} />
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="mt-2"
            busy={uploading}
            disabled={design.file_ids.length >= FILES_MAX}
            onClick={() => input.current?.click()}
          >
            <Paperclip aria-hidden="true" /> Attach a picture or PDF
          </Button>
          {fileError ? (
            <p role="alert" className="mt-1 text-sm text-danger">
              {fileError}
            </p>
          ) : null}
        </div>
      </div>

      <section aria-labelledby="gift-preview-title" className="grid content-start gap-2">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h3 id="gift-preview-title" className="text-sm font-semibold text-fg">
            What they&apos;ll get
          </h3>
          {choices.length > 1 ? (
            <label className="flex items-center gap-2 text-xs text-fg-muted">
              As
              <Select value={String(who)} onChange={(e) => setWho(Number(e.target.value))} className="h-8 py-0 text-xs">
                {choices.map((c, i) => (
                  <option key={`${c.label}-${i}`} value={i}>
                    {c.label}
                  </option>
                ))}
              </Select>
            </label>
          ) : null}
        </div>
        {preview ? (
          <>
            <p className="truncate text-sm text-fg">
              <span className="text-fg-muted">Subject: </span>
              {preview.subject}
            </p>
            <EmailFrame html={preview.html} pictures={pictures} />
          </>
        ) : previewError ? (
          <p role="alert" className="text-sm text-danger">
            {previewError}
          </p>
        ) : (
          <p className="text-sm text-fg-muted">Drawing the preview…</p>
        )}
        {wrote ? (
          <p className="flex items-start gap-2 text-xs text-fg-muted">
            <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0" /> Corner Room checks your words and files before anyone is emailed. If something
            can&apos;t go out as it is, the gift still goes, in Corner Room&apos;s own words.
          </p>
        ) : null}
      </section>
    </div>
  );
}
