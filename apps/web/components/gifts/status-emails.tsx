"use client";

/* The automatic gift emails of one campaign (owner, 2026-11-07, D-CAMPAIGN-05 and D-CAMPAIGN-06;
 * made plain 2026-11-08; 2026-11-09, D-CAMPAIGN-07). One editor per status that emails the buyer by
 * itself (Dispatched, Returned, Missing): what buyers get now, three steps (write, approval, buyers
 * get it), then the words (templates, preview as a real buyer, button, files). None of its buttons
 * emails a buyer: they are emailed when their gift moves to that status. Emails to buyers picked by
 * hand are written in GiftSendComposer and go to Corner Room as one request with their people.
 * Every state comes from the API; the server writes and sends. */

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, CircleAlert, CircleCheck, Hourglass, Info, MousePointerClick, RotateCcw, Send, SendHorizontal, Sparkles, Undo2, X } from "lucide-react";

import { FilesPicker } from "@/components/artist-mail/files-picker";
import { MailPreview } from "@/components/artist-mail/mail-preview";
import { RichEditor } from "@/components/artist-mail/rich-editor";
import { Badge, Button, Card, Input } from "@/components/ds";
import { Textarea } from "@/components/ds/input";
import { useAsync } from "@/components/use-async";
import { fetchMailOverview, type MailFile } from "@/features/artist-mail/api";
import {
  resetStatusMail,
  reviewStatusMail,
  saveStatusMail,
  submitStatusMail,
  testStatusMail,
  type StatusMail,
  type StatusMailInput,
  type StatusMailPerson,
  type StatusMails,
} from "@/features/gifts/api";
import { ALL_FILL_KEYS, GIFT_UPDATE_FILL_INS, unfilledMarks, unknownFillIns } from "@/lib/artist-mail-view";
import { friendlyError } from "@/lib/error-copy";
import { giftTemplates } from "@/lib/gift-status-mail-templates";
import {
  STATUS_MAIL_TAB,
  buttonProblem,
  changed,
  inUseLabel,
  notInUseLine,
  peopleIn,
  previewValues,
  sendingVersion,
  startingVersion,
  subjectForAll,
  submitDoneLine,
  submitLabel,
  workflowSteps,
  type StepTone,
} from "@/lib/gift-status-mail-view";

export type Notice = { tone: "success" | "info" | "problem"; text: string };

/** One loud line for whatever just happened, moved into view so it can't be missed. */
export function Banner({ notice, onClose }: { notice: Notice | null; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (notice) ref.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, [notice]);
  return (
    <div role="status" aria-live="polite" ref={ref}>
      {notice ? (
        <div className="gm-banner" data-tone={notice.tone}>
          {notice.tone === "success" ? (
            <CircleCheck aria-hidden="true" className="size-5" />
          ) : notice.tone === "problem" ? (
            <CircleAlert aria-hidden="true" className="size-5" />
          ) : (
            <Info aria-hidden="true" className="size-5" />
          )}
          <p className="min-w-0 flex-1">{notice.text}</p>
          <button type="button" className="cr-focus -m-1 p-1 text-fg-muted hover:text-fg" aria-label="Close this message" onClick={onClose}>
            <X aria-hidden="true" className="size-4" />
          </button>
        </div>
      ) : null}
    </div>
  );
}

function StepMark({ tone, n }: { tone: StepTone; n: number }) {
  if (tone === "done") return <Check aria-hidden="true" className="gm-step-mark" />;
  if (tone === "waiting") return <Hourglass aria-hidden="true" className="gm-step-mark p-1" />;
  if (tone === "problem") return <CircleAlert aria-hidden="true" className="gm-step-mark p-1" />;
  return (
    <span aria-hidden="true" className="gm-step-mark">
      {n}
    </span>
  );
}

const TONE_WORD: Record<StepTone, string> = { done: "Done", now: "To do", waiting: "Waiting", problem: "Needs a change", skip: "" };

export function AutomaticEmailEditor({
  campaignId,
  mails,
  item,
  onChanged,
  onNotice,
}: {
  campaignId: string;
  mails: StatusMails;
  item: StatusMail;
  onChanged: (next: StatusMails, notice: Notice | null) => void;
  onNotice: (notice: Notice | null) => void;
}) {
  const saved = startingVersion(item);
  const [draft, setDraft] = useState<StatusMailInput>(saved);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const overview = useAsync(() => fetchMailOverview(mails.profile), [mails.profile.kind, mails.profile.id]);
  const [files, setFiles] = useState<MailFile[] | null>(null);
  const allFiles = files ?? (overview.status === "ok" ? overview.data.files : []);
  const atOnce = Boolean(mails.approves_at_once);

  const voice = mails.profile.kind === "band" ? "we" : "I";
  const web = typeof window === "undefined" ? "" : window.location.origin;
  const templates = useMemo(() => giftTemplates(item.status, voice, web), [item.status, voice, web]);
  const named = mails.people.filter((p) => p.reachable);
  const previewPerson: StatusMailPerson | null =
    named.find((p) => p.id === previewId) ?? peopleIn(named, item.status)[0] ?? named[0] ?? null;
  const values = previewValues(previewPerson, mails.artist, mails.music, mails.campaign.gift_items);

  const editing = item.state !== "IN_REVIEW";
  const dirty = changed(draft, saved);
  const marks = unfilledMarks(`${draft.subject}\n${draft.body}\n${draft.button_label ?? ""}`);
  const typos = unknownFillIns(`${draft.subject}\n${draft.body}`, ALL_FILL_KEYS);
  const buttonIssue = buttonProblem(draft.button_label, draft.button_url);
  const canSave = Boolean(draft.subject.trim() && draft.body.trim()) && !typos.length && !buttonIssue;
  const shown = editing ? draft : startingVersion(item);
  const inUse = sendingVersion(item);
  const steps = workflowSteps(item, atOnce);
  const pending = notInUseLine(item);
  const status = STATUS_MAIL_TAB[item.status].toLowerCase();
  const set = (patch: Partial<StatusMailInput>) => setDraft((d) => ({ ...d, ...patch }));
  const payload = (): StatusMailInput => ({
    ...draft,
    button_label: draft.button_label?.trim() || null,
    button_url: draft.button_url?.trim() || null,
  });

  async function run(key: string, job: () => Promise<StatusMails | null>, done: (next: StatusMails | null) => Notice | null) {
    setBusy(key);
    onNotice(null);
    try {
      const next = await job();
      const n = done(next);
      if (next) onChanged(next, n);
      else onNotice(n);
    } catch (err) {
      onNotice({ tone: "problem", text: friendlyError(err, "That didn't go through. Please try again.") });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card tone="solid" className="grid gap-6 p-5" aria-labelledby={`sm-${item.status}`}>
      {/* What buyers get now. */}
      <section className="gm-inuse" aria-labelledby={`sm-${item.status}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id={`sm-${item.status}`} className="text-sm font-semibold text-fg-muted">
            When a gift is marked {status}, the buyer gets
          </h3>
          <Badge tone={item.live ? "positive" : "neutral"}>{inUseLabel(item)}</Badge>
        </div>
        <p className="mt-2 text-lg font-bold text-fg">&ldquo;{subjectForAll(inUse.subject, mails.artist, mails.music, mails.campaign.gift_items)}&rdquo;</p>
        {pending ? (
          <p className="mt-2 flex items-start gap-2 text-sm text-fg">
            <Hourglass aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" /> {pending}
          </p>
        ) : null}
      </section>

      <ol className="gm-steps" aria-label="How this email works">
        {steps.map((s, i) => (
          <li key={s.title} className="gm-step" data-tone={s.tone}>
            <StepMark tone={s.tone} n={i + 1} />
            <p>
              <span className="gm-step-title">
                {s.title}
                {TONE_WORD[s.tone] ? <span className="sr-only">: {TONE_WORD[s.tone]}</span> : null}
              </span>
              {s.line}
            </p>
          </li>
        ))}
      </ol>

      {/* Part 1: write. Nothing here emails a buyer. */}
      <section className="gm-part" aria-labelledby={`write-${item.status}`}>
        <h4 id={`write-${item.status}`} className="gm-part-title">
          Write the email
        </h4>
        <p className="mt-1 text-sm text-fg-muted">Writing, saving and approving never emails a buyer. They get it when their gift is marked {status}.</p>

        {editing ? (
          <fieldset className="mt-4">
            <legend className="flex items-center gap-2 text-[0.8125rem] font-semibold text-fg">
              <Sparkles aria-hidden="true" className="size-4 text-highlight" /> Start from a template
            </legend>
            <p className="mt-1 text-sm text-fg-muted">One click writes the whole email. Then add a line or change a word.</p>
            <div className="am-chips mt-2">
              <button
                type="button"
                className="am-occasion cr-focus"
                aria-pressed={draft.subject === item.default_subject && draft.body === item.default_body}
                onClick={() => setDraft({ subject: item.default_subject, body: item.default_body, button_label: null, button_url: null, file_ids: draft.file_ids })}
              >
                Corner Room&apos;s wording
              </button>
              {templates.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className="am-occasion cr-focus"
                  aria-pressed={draft.subject === t.subject && draft.body === t.body}
                  onClick={() =>
                    setDraft({ subject: t.subject, body: t.body, button_label: t.button?.label ?? null, button_url: t.button?.url ?? null, file_ids: draft.file_ids })
                  }
                >
                  {t.label}
                </button>
              ))}
            </div>
          </fieldset>
        ) : (
          <p className="mt-4 flex items-start gap-2 text-sm text-fg">
            <Hourglass aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />
            Your changes are waiting for Corner Room, so they can&apos;t be edited now. They&apos;re in the preview. Until they&apos;re approved,
            buyers get the email in use above.
          </p>
        )}

        <div className="mt-5 grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="grid content-start gap-4">
            {named.length ? (
              <label className="grid gap-1 text-[0.8125rem] font-semibold text-fg">
                Preview as
                <select
                  className="cr-focus min-h-10 border border-line-strong bg-surface-sunken px-3 text-sm text-fg"
                  value={previewPerson?.id ?? ""}
                  onChange={(e) => setPreviewId(e.target.value)}
                >
                  {named.slice(0, 500).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name || "A buyer with no name on file"}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {editing ? (
              <>
                <RichEditor label="Subject" singleLine value={draft.subject} onChange={(subject) => set({ subject })} values={values} fillIns={GIFT_UPDATE_FILL_INS} />
                <RichEditor label="Message" value={draft.body} onChange={(body) => set({ body })} values={values} fillIns={GIFT_UPDATE_FILL_INS} />
                <p className="text-xs text-fg-muted">Highlighted words change for each buyer. Select words and tap Link to add a link. Write in any language.</p>
                <fieldset className="grid gap-2">
                  <legend className="flex items-center gap-2 text-[0.8125rem] font-semibold text-fg">
                    <MousePointerClick aria-hidden="true" className="size-4 text-highlight" /> Button (optional)
                  </legend>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Input
                      aria-label="Button words"
                      placeholder="For example: Track your parcel"
                      value={draft.button_label ?? ""}
                      maxLength={80}
                      onChange={(e) => set({ button_label: e.target.value })}
                    />
                    <Input
                      aria-label="Button link"
                      placeholder="https://"
                      inputMode="url"
                      value={draft.button_url ?? ""}
                      onChange={(e) => set({ button_url: e.target.value })}
                    />
                  </div>
                  {buttonIssue ? <p className="text-sm text-danger">{buttonIssue}</p> : null}
                </fieldset>
                {marks.length ? (
                  <p role="alert" className="text-sm text-danger">
                    Fill in {marks.join(", ")} first.
                  </p>
                ) : null}
                {typos.length ? <p className="text-sm text-danger">{typos.join(", ")} won&apos;t be filled in. Use the buttons above the message.</p> : null}
              </>
            ) : null}
          </div>
          <MailPreview
            artist={mails.artist}
            subject={shown.subject}
            body={shown.body}
            values={values}
            kind="GIFT_UPDATE"
            button={shown.button_label && shown.button_url ? { label: shown.button_label, url: shown.button_url } : null}
            files={allFiles.filter((f) => shown.file_ids.includes(f.id))}
          />
        </div>

        {editing && overview.status === "ok" ? (
          <div className="mt-5">
            <FilesPicker
              profile={mails.profile}
              files={allFiles}
              onFiles={setFiles}
              value={draft.file_ids}
              onChange={(file_ids) => set({ file_ids })}
              maxBytes={overview.data.file_max_bytes}
            />
          </div>
        ) : null}

        {editing ? (
          <div className="mt-5 grid gap-2">
            <div className="flex flex-wrap gap-2">
              <Button
                busy={busy === "submit"}
                disabled={!canSave || marks.length > 0 || (!dirty && item.state !== "DRAFT" && item.state !== "RETURNED")}
                onClick={() =>
                  void run(
                    "submit",
                    async () => {
                      if (dirty || !item.state) await saveStatusMail(campaignId, item.status, payload());
                      return submitStatusMail(campaignId, item.status);
                    },
                    (next) => {
                      const it = next?.items.find((i) => i.status === item.status);
                      return { tone: it?.state === "APPROVED" ? "success" : "info", text: submitDoneLine(it) };
                    },
                  )
                }
              >
                {atOnce ? <Check aria-hidden="true" /> : <SendHorizontal aria-hidden="true" />} {submitLabel(atOnce)}
              </Button>
              <Button
                variant="secondary"
                busy={busy === "save"}
                disabled={!canSave || !dirty}
                onClick={() =>
                  void run("save", () => saveStatusMail(campaignId, item.status, payload()), () => ({
                    tone: "info",
                    text: "Draft saved. It isn't in use and nobody was emailed.",
                  }))
                }
              >
                Save draft
              </Button>
              <Button
                variant="ghost"
                busy={busy === "test"}
                disabled={!canSave}
                onClick={() => {
                  let to = "";
                  void run(
                    "test",
                    async () => {
                      to = (await testStatusMail(campaignId, item.status, { ...payload(), recipient_id: previewPerson?.id ?? null })).sent_to;
                      return null;
                    },
                    () => ({
                      tone: "success",
                      text: `Test sent to you at ${to}${previewPerson?.name ? `, written as ${previewPerson.name} will see it` : ""}. No buyer was emailed.`,
                    }),
                  );
                }}
              >
                <Send aria-hidden="true" /> Send me a test
              </Button>
              {item.state ? (
                <Button
                  variant="ghost"
                  busy={busy === "reset"}
                  onClick={() =>
                    void run("reset", () => resetStatusMail(campaignId, item.status), () => ({
                      tone: "info",
                      text: "Back to Corner Room's wording. Buyers get it from now on. Nobody was emailed.",
                    }))
                  }
                >
                  <RotateCcw aria-hidden="true" /> Use Corner Room&apos;s wording
                </Button>
              ) : null}
            </div>
            <p className="text-xs text-fg-muted">
              {atOnce
                ? "Use this email puts it in use at once. Save draft keeps it for later."
                : "Send for approval sends it to Corner Room. Once approved it is in use. Save draft keeps it for later."}{" "}
              None of these buttons emails a buyer.
            </p>
          </div>
        ) : null}

        {item.can_review ? <StaffReview campaignId={campaignId} item={item} note={note} setNote={setNote} busy={busy} run={run} /> : null}
      </section>

    </Card>
  );
}

function StaffReview({
  campaignId,
  item,
  note,
  setNote,
  busy,
  run,
}: {
  campaignId: string;
  item: StatusMail;
  note: string;
  setNote: (v: string) => void;
  busy: string | null;
  run: (key: string, job: () => Promise<StatusMails | null>, done: (next: StatusMails | null) => Notice | null) => Promise<void>;
}) {
  return (
    <div className="mt-5 border-t border-line pt-4">
      <p className="text-sm font-semibold text-fg">Corner Room review</p>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <Button
          busy={busy === "approve"}
          onClick={() =>
            void run("approve", () => reviewStatusMail(campaignId, item.status, "approve"), () => ({
              tone: "success",
              text: "Approved. This version is in use from now on. Nobody was emailed just now.",
            }))
          }
        >
          <Check aria-hidden="true" /> Approve
        </Button>
        <div className="min-w-[16rem] flex-1">
          <Textarea aria-label="What to change" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What to change" />
        </div>
        <Button
          variant="secondary"
          busy={busy === "reject"}
          disabled={!note.trim()}
          onClick={() =>
            void run("reject", () => reviewStatusMail(campaignId, item.status, "reject", note), () => ({ tone: "info", text: "Sent back to the artist." }))
          }
        >
          <Undo2 aria-hidden="true" /> Send back
        </Button>
      </div>
    </div>
  );
}
