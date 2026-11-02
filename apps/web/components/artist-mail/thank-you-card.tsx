"use client";

/*
 * The thank-you email (owner, 2026-11-02, D-MAIL-01): Corner Room sends it from "{Artist} via
 * Corner Room" to everyone who buys the act's music, once per order. Turn it on and change the words
 * any time; changes go live at once. It always sends (it is part of the purchase), with no stop link.
 */

import { FormEvent, useState } from "react";
import { HeartHandshake, RotateCcw, Save, Send } from "lucide-react";

import { Button, Card, Field, Input } from "@/components/ds";
import { Textarea } from "@/components/ds/input";
import { MailPreview } from "@/components/artist-mail/mail-preview";
import { saveThankYou, sendTestMail, type MailProfile, type ThankYou } from "@/features/artist-mail/api";
import { ApiError } from "@/lib/api/client";
import { FILL_INS } from "@/lib/artist-mail-view";

export function ThankYouCard({ profile, artist, initial }: { profile: MailProfile; artist: string; initial: ThankYou }) {
  const [saved, setSaved] = useState(initial);
  const [on, setOn] = useState(initial.on);
  const [subject, setSubject] = useState(initial.subject);
  const [body, setBody] = useState(initial.body);
  const [busy, setBusy] = useState<"save" | "test" | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const changed = on !== saved.on || subject !== saved.subject || body !== saved.body;

  async function save(e?: FormEvent) {
    e?.preventDefault();
    setBusy("save");
    setMessage(null);
    try {
      const next = await saveThankYou(profile, { on, subject, body });
      setSaved(next);
      setSubject(next.subject);
      setBody(next.body);
      setMessage({ ok: true, text: next.on ? "Saved. New buyers get this email from now on." : "Saved. Thank-you emails are off." });
    } catch (err) {
      setMessage({ ok: false, text: err instanceof ApiError ? err.message : "That didn't save. Try again." });
    } finally {
      setBusy(null);
    }
  }

  async function test() {
    setBusy("test");
    setMessage(null);
    try {
      await sendTestMail(profile, { kind: "THANK_YOU", subject, body });
      setMessage({ ok: true, text: "A test is on its way to your account email." });
    } catch (err) {
      setMessage({ ok: false, text: err instanceof ApiError ? err.message : "The test didn't send. Try again." });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card as="section" aria-labelledby={`thanks-${profile.id}`} className="p-5">
      <form onSubmit={save} className="grid gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 id={`thanks-${profile.id}`} className="flex items-center gap-2 text-lg font-bold text-fg">
              <HeartHandshake aria-hidden="true" className="size-5 text-highlight" /> Thank-you email
            </h3>
            <p className="mt-1 max-w-2xl text-sm text-fg-muted">
              Sent by Corner Room to everyone who buys your music, once per order. Changes go live as soon as you save.
              {saved.sent_count ? ` Sent ${saved.sent_count} so far.` : ""}
            </p>
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm font-semibold text-fg">
          <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} />
          Send a thank-you email to everyone who buys my music
        </label>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="grid content-start gap-4">
            <Field label="Subject" required>
              {(c) => <Input {...c} value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} />}
            </Field>
            <Field label="Message" required hint="Plain text. Links work. Write in any language.">
              {(c) => <Textarea {...c} value={body} onChange={(e) => setBody(e.target.value)} maxLength={10000} rows={8} />}
            </Field>
            <p className="text-xs text-fg-muted">
              Fill-ins: {FILL_INS.map((f) => `{${f.key}} ${f.label.toLowerCase()}`).join(" · ")}
            </p>
          </div>
          <MailPreview artist={artist} subject={subject} body={body} kind="THANK_YOU" />
        </div>
        {message ? (
          <p role={message.ok ? "status" : "alert"} className={`text-sm ${message.ok ? "text-fg" : "text-danger"}`}>
            {message.text}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" busy={busy === "save"} disabled={!changed || !subject.trim() || !body.trim()}>
            <Save aria-hidden="true" /> Save
          </Button>
          <Button variant="secondary" busy={busy === "test"} disabled={!subject.trim() || !body.trim()} onClick={() => void test()}>
            <Send aria-hidden="true" /> Send me a test
          </Button>
          <Button
            variant="ghost"
            disabled={subject === saved.default_subject && body === saved.default_body}
            onClick={() => {
              setSubject(saved.default_subject);
              setBody(saved.default_body);
            }}
          >
            <RotateCcw aria-hidden="true" /> Use Corner Room&apos;s wording
          </Button>
        </div>
      </form>
    </Card>
  );
}
