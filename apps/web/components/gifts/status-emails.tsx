"use client";

/* Gift status emails for one gift campaign (owner, 2026-11-07, D-CAMPAIGN-05 and D-CAMPAIGN-06),
 * built like the act's other emails: one tab per status that emails the buyer (Dispatched,
 * Returned, Missing). Pick a ready-made template in one click and change a line; preview it as any
 * buyer, by their own name; add a button and files; send yourself a test; send it for review. The
 * version that sends now can also go to chosen buyers in that status at once. These emails always
 * send, whatever the buyer's email choices: they're about a gift the buyer is owed. Every state
 * comes from the API; the server writes and sends every email. */

import { useMemo, useState } from "react";
import { Check, CircleAlert, MousePointerClick, RotateCcw, Send, SendHorizontal, Sparkles, Undo2, Users } from "lucide-react";

import { Segmented } from "@/components/artist-mail/audience-builder";
import { FilesPicker } from "@/components/artist-mail/files-picker";
import { MailPreview } from "@/components/artist-mail/mail-preview";
import { RichEditor } from "@/components/artist-mail/rich-editor";
import { Button, Card, ErrorState, Input, Skeleton } from "@/components/ds";
import { Textarea } from "@/components/ds/input";
import { RetryButton } from "@/components/shell/staff-panel";
import { loadErrorMessage, useAsync } from "@/components/use-async";
import { fetchMailOverview, type MailFile } from "@/features/artist-mail/api";
import {
  fetchStatusMails,
  resetStatusMail,
  reviewStatusMail,
  saveStatusMail,
  sendStatusMail,
  submitStatusMail,
  testStatusMail,
  type StatusMail,
  type StatusMailInput,
  type StatusMailPerson,
  type StatusMails,
  type StatusMailStatus,
} from "@/features/gifts/api";
import { ALL_FILL_KEYS, GIFT_UPDATE_FILL_INS, unfilledMarks, unknownFillIns } from "@/lib/artist-mail-view";
import { friendlyError } from "@/lib/error-copy";
import { giftTemplates } from "@/lib/gift-status-mail-templates";
import {
  STATE_LABEL,
  STATUS_MAIL_TAB,
  STATUS_MAIL_TITLE,
  STATUS_MAIL_WHEN,
  buttonProblem,
  changed,
  peopleIn,
  previewValues,
  sendingLine,
  sendingVersion,
  sentCountLine,
  startingVersion,
  subjectForAll,
} from "@/lib/gift-status-mail-view";

const STATUSES: StatusMailStatus[] = ["DISPATCHED", "RETURNED", "MISSING"];

export function StatusEmails({ campaignId }: { campaignId: string }) {
  const data = useAsync(() => fetchStatusMails(campaignId), [campaignId]);
  const [override, setOverride] = useState<StatusMails | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<StatusMailStatus>("DISPATCHED");
  if (data.status === "loading") return <Skeleton className="h-64 w-full" />;
  if (data.status === "error") {
    return <ErrorState title="Emails unavailable" message={loadErrorMessage(data.error, "these emails")} action={<RetryButton onClick={data.reload} />} />;
  }
  const mails = override && override.campaign.id === campaignId ? override : data.data;
  const item = mails.items.find((i) => i.status === tab) ?? mails.items[0];
  return (
    <div className="grid gap-5">
      <p className="text-sm text-fg-muted">
        Each buyer gets these from &quot;{mails.artist} via Corner Room&quot;, greeted by their own name, when their gift moves. They always send, even to
        buyers who stopped your other emails, because they&apos;re about a gift the buyer is owed. Corner Room checks your version once before it
        replaces ours.
      </p>
      <Segmented<StatusMailStatus>
        label="Gift status"
        value={tab}
        options={Object.fromEntries(
          STATUSES.map((s) => {
            const it = mails.items.find((i) => i.status === s);
            return [s, `${STATUS_MAIL_TAB[s]}${it?.state === "IN_REVIEW" ? " · waiting" : it?.live ? " · yours" : ""}`];
          }),
        ) as Record<StatusMailStatus, string>}
        onChange={setTab}
      />
      <p role="status" className="text-sm font-semibold text-fg empty:hidden">
        {notice}
      </p>
      <StatusMailComposer
        key={`${item.status}-${item.state}-${item.subject}-${item.live_subject}`}
        campaignId={campaignId}
        mails={mails}
        item={item}
        onChanged={(next, message) => {
          setOverride(next);
          setNotice(message ? `${STATUS_MAIL_TITLE[item.status]}: ${message}` : null);
        }}
      />
    </div>
  );
}

function StatusMailComposer({
  campaignId,
  mails,
  item,
  onChanged,
}: {
  campaignId: string;
  mails: StatusMails;
  item: StatusMail;
  onChanged: (next: StatusMails, message: string | null) => void;
}) {
  const saved = startingVersion(item);
  const [draft, setDraft] = useState<StatusMailInput>(saved);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const overview = useAsync(() => fetchMailOverview(mails.profile), [mails.profile.kind, mails.profile.id]);
  const [files, setFiles] = useState<MailFile[] | null>(null);
  const allFiles = files ?? (overview.status === "ok" ? overview.data.files : []);

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
  const set = (patch: Partial<StatusMailInput>) => setDraft((d) => ({ ...d, ...patch }));
  const payload = (): StatusMailInput => ({
    ...draft,
    button_label: draft.button_label?.trim() || null,
    button_url: draft.button_url?.trim() || null,
  });

  async function run(key: string, job: () => Promise<StatusMails | null>, message: string) {
    setBusy(key);
    setError(null);
    setInfo(null);
    try {
      const next = await job();
      if (next) onChanged(next, message);
      else if (message) setInfo(message);
    } catch (err) {
      setError(friendlyError(err, "That didn't go through. Please try again."));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card tone="solid" className="p-5" aria-labelledby={`sm-${item.status}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id={`sm-${item.status}`} className="text-base font-bold text-fg">
            {STATUS_MAIL_TITLE[item.status]}
          </h3>
          <p className="mt-1 text-sm text-fg-muted">{STATUS_MAIL_WHEN[item.status]}</p>
        </div>
        <div className="text-right text-sm">
          <p className="font-semibold text-highlight">{item.state ? STATE_LABEL[item.state] : "Corner Room's wording"}</p>
          <p className="text-fg-muted">{sentCountLine(item.sent_count)}</p>
        </div>
      </div>
      <p className="mt-2 text-sm text-fg">{sendingLine(item)}</p>
      {item.state === "RETURNED" && item.review_note ? (
        <p className="mt-3 flex items-start gap-2 text-sm text-fg">
          <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-danger" />
          <span>Corner Room asked: {item.review_note}</span>
        </p>
      ) : null}

      {editing ? (
        <fieldset className="mt-5">
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
      ) : null}

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
                  Fill in {marks.join(", ")} before sending for review.
                </p>
              ) : null}
              {typos.length ? <p className="text-sm text-danger">{typos.join(", ")} won&apos;t be filled in. Use the buttons above the message.</p> : null}
            </>
          ) : (
            <p className="text-sm text-fg">
              Waiting for Corner Room. Your version is in the preview; you can still send the version that sends now to chosen buyers below.
            </p>
          )}
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
        <div className="mt-5 flex flex-wrap gap-2">
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
                "Sent to Corner Room for review.",
              )
            }
          >
            <SendHorizontal aria-hidden="true" /> Send for review
          </Button>
          <Button
            variant="secondary"
            busy={busy === "save"}
            disabled={!canSave || !dirty}
            onClick={() => void run("save", () => saveStatusMail(campaignId, item.status, payload()), "Saved.")}
          >
            <Check aria-hidden="true" /> Save
          </Button>
          <Button
            variant="ghost"
            busy={busy === "test"}
            disabled={!canSave}
            onClick={() =>
              void run(
                "test",
                async () => {
                  const out = await testStatusMail(campaignId, item.status, { ...payload(), recipient_id: previewPerson?.id ?? null });
                  setInfo(`A test${previewPerson?.name ? `, written as ${previewPerson.name} will see it,` : ""} is on its way to ${out.sent_to}.`);
                  return null;
                },
                "",
              )
            }
          >
            <Send aria-hidden="true" /> Send me a test
          </Button>
          {item.state ? (
            <Button
              variant="ghost"
              busy={busy === "reset"}
              onClick={() => void run("reset", () => resetStatusMail(campaignId, item.status), "Back to Corner Room's wording.")}
            >
              <RotateCcw aria-hidden="true" /> Use Corner Room&apos;s wording
            </Button>
          ) : null}
        </div>
      ) : null}

      {item.can_review ? (
        <div className="mt-5 border-t border-line pt-4">
          <p className="text-sm font-semibold text-fg">Corner Room review</p>
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <Button
              busy={busy === "approve"}
              onClick={() => void run("approve", () => reviewStatusMail(campaignId, item.status, "approve"), "Approved. This version sends from now on.")}
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
              onClick={() => void run("reject", () => reviewStatusMail(campaignId, item.status, "reject", note), "Sent back to the artist.")}
            >
              <Undo2 aria-hidden="true" /> Send back
            </Button>
          </div>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="mt-3 flex items-start gap-2 text-sm text-danger">
          <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      ) : null}
      {info ? (
        <p role="status" className="mt-3 text-sm text-fg">
          {info}
        </p>
      ) : null}

      <SendToChosen campaignId={campaignId} mails={mails} item={item} onChanged={onChanged} />
    </Card>
  );
}

/** Send the version that sends now to chosen buyers whose gift is in this status. */
function SendToChosen({
  campaignId,
  mails,
  item,
  onChanged,
}: {
  campaignId: string;
  mails: StatusMails;
  item: StatusMail;
  onChanged: (next: StatusMails, message: string | null) => void;
}) {
  const people = peopleIn(mails.people, item.status);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const version = sendingVersion(item);
  const all = people.length > 0 && people.every((p) => chosen.has(p.id));
  const flip = (id: string) =>
    setChosen((c) => {
      const next = new Set(c);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const next = await sendStatusMail(campaignId, item.status, [...chosen]);
      setChosen(new Set());
      onChanged(next, `emailed ${next.sent ?? 0} ${next.sent === 1 ? "buyer" : "buyers"} now.`);
    } catch (err) {
      setError(friendlyError(err, "That didn't go through. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-6 border-t border-line pt-5" aria-labelledby={`send-${item.status}`}>
      <h4 id={`send-${item.status}`} className="flex items-center gap-2 text-sm font-bold text-fg">
        <Users aria-hidden="true" className="size-4 text-highlight" /> Email chosen buyers now
      </h4>
      <p className="mt-1 text-sm text-fg-muted">
        Sends &quot;{subjectForAll(version.subject, mails.artist, mails.music, mails.campaign.gift_items)}&quot; ({item.live ? "your approved email" : "Corner Room's wording"}) to the
        buyers you tick whose gift is {STATUS_MAIL_TAB[item.status].toLowerCase()}.
      </p>
      {people.length === 0 ? (
        <p className="mt-3 text-sm text-fg">No gift is {STATUS_MAIL_TAB[item.status].toLowerCase()} right now.</p>
      ) : (
        <>
          <label className="mt-3 flex items-center gap-2 text-sm font-semibold text-fg">
            <input type="checkbox" checked={all} onChange={() => setChosen(all ? new Set() : new Set(people.map((p) => p.id)))} />
            Everyone here ({people.length})
          </label>
          <ul className="mt-2 grid max-h-64 gap-1 overflow-auto sm:grid-cols-2">
            {people.map((p) => (
              <li key={p.id}>
                <label className="flex items-center gap-2 text-sm text-fg">
                  <input type="checkbox" checked={chosen.has(p.id)} onChange={() => flip(p.id)} />
                  {p.name || "A buyer with no name on file"}
                </label>
              </li>
            ))}
          </ul>
          <Button className="mt-3" variant="secondary" busy={busy} disabled={chosen.size === 0} onClick={() => void send()}>
            <Send aria-hidden="true" /> Email {chosen.size || ""} {chosen.size === 1 ? "buyer" : "buyers"} now
          </Button>
        </>
      )}
      {error ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
    </section>
  );
}
