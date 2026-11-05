"use client";

/* The email as one buyer will see it (owner, 2026-11-02, D-MAIL-01 and D-MAIL-02): drawn the way
 * `artist_mail_render.py` writes it, with the cover, the message, a Listen button, any files and
 * the footer. Fill-ins show that buyer's own words, lightly marked. The server writes the real one. */

import type { ReactNode } from "react";

import type { MailFile, MailWork } from "@/features/artist-mail/api";
import { coverUrl } from "@/lib/cover-view";
import { parseRich, plainText, type MailValues } from "@/lib/artist-mail-view";

function Words({ text, values }: { text: string; values: MailValues }) {
  const paragraphs = text.trim().split(/\n{2,}/).filter((p) => p.trim());
  if (paragraphs.length === 0) return <p className="text-[#5d5a7e]">Nothing written yet</p>;
  return (
    <>
      {paragraphs.map((p, i) => (
        <p key={i}>
          {parseRich(p).map((t, j): ReactNode => {
            if (t.kind === "text") return t.text;
            if (t.kind === "fill")
              return (
                <span key={j} className="am-fill">
                  {values[t.key]}
                </span>
              );
            return (
              <a key={j} href={t.url} target="_blank" rel="noreferrer noopener">
                {plainText(t.label, values)}
              </a>
            );
          })}
        </p>
      ))}
    </>
  );
}

export function MailPreview({
  artist,
  subject,
  body,
  values,
  kind,
  work,
  files = [],
  note = null,
  claimFor = null,
}: {
  artist: string;
  subject: string;
  body: string;
  values: MailValues;
  kind: "THANK_YOU" | "MANUAL" | "GIFT";
  /** A music gift (D-GIFT-MUSIC-01): the person's own note, and whether they have an account yet. */
  note?: string | null;
  claimFor?: string | null;
  /** The music the email is about for this buyer: its cover and Listen button. */
  work?: (MailWork & { title?: string }) | null;
  files?: Pick<MailFile, "id" | "name" | "kind">[];
}) {
  const cover = work ? coverUrl(work.type === "RELEASE" ? { release: work.id } : { track: work.id }, 480) : null;
  return (
    <section aria-label="Preview of the email" className="am-preview">
      <p className="mb-2 text-xs text-[#5d5a7e]">
        <span className="font-semibold text-[#1b1838]">From:</span> {artist} via Corner Room
        <br />
        <span className="font-semibold text-[#1b1838]">Subject:</span> {subject.trim() ? plainText(subject, values) : "No subject yet"}
      </p>
      <div className="am-preview-card">
        <div className="am-preview-head">
          <strong>{artist}</strong>
          <span>via Corner Room</span>
        </div>
        {cover ? (
          // The cover, as the email shows it (no next/image: this is the email's own picture).
          // eslint-disable-next-line @next/next/no-img-element
          <img src={cover} alt="" className="block aspect-square w-full object-cover" onError={(e) => (e.currentTarget.style.display = "none")} />
        ) : null}
        <div className="am-preview-body">
          <Words text={note?.trim() ? body.trimEnd() + "\n\n" + note.trim() : body} values={values} />
          {claimFor ? (
            <>
              <p>
                Your music is waiting for {claimFor}. Create your free Corner Room account with this email address and it is yours.
              </p>
              <span className="am-preview-button">Create your free account</span>
            </>
          ) : work?.title ? (
            <span className="am-preview-button">Listen to {work.title} on Corner Room</span>
          ) : null}
          {files.length ? (
            <div className="am-preview-files">
              <p className="mb-1 text-[0.6875rem] font-bold uppercase tracking-[0.08em] text-[#5d5a7e]">From {artist}, for you</p>
              <ul className="list-disc pl-5">
                {files.map((f) => (
                  <li key={f.id} className="font-semibold text-[#2e2860] underline">
                    {f.kind === "FILE" ? "Download" : "Open"} {f.name}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
        <div className="am-preview-foot">
          {kind === "THANK_YOU" ? (
            <>
              Sent by Corner Room for {artist}. Replies to this email aren&apos;t read.
              <br />
              <span className="underline">Your music on Corner Room</span>
            </>
          ) : kind === "GIFT" ? (
            <>
              You&apos;re getting this because {artist} gave you music on Corner Room. Replies to this email aren&apos;t read.
              <br />
              <span className="underline">Stop emails from {artist}</span>
            </>
          ) : (
            <>
              You&apos;re getting this because you bought music from {artist} on Corner Room. Replies to this email aren&apos;t read.
              <br />
              <span className="underline">Stop emails from {artist}</span>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
