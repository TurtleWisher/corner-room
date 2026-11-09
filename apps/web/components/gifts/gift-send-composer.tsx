"use client";

/*
 * Write an email to buyers you pick, about one gift campaign (owner, 2026-11-09, D-CAMPAIGN-07).
 * One screen, top to bottom: what it's about, who gets it (searchable, already filled with the
 * people ticked in Collectibles), the words (templates, fill-ins, a button, files) beside a live
 * preview as one of those people, then one button. For the act's team that button sends the words
 * and the people to Corner Room together; nobody is emailed until it's approved and they press
 * Send. Staff send at once. The server checks everything again and writes every email.
 */

import { useMemo, useState } from "react";
import { CircleAlert, MousePointerClick, Send, SendHorizontal, Sparkles, Users, X } from "lucide-react";

import { FilesPicker } from "@/components/artist-mail/files-picker";
import { MailPreview } from "@/components/artist-mail/mail-preview";
import { RichEditor } from "@/components/artist-mail/rich-editor";
import { Button, Input } from "@/components/ds";
import { Check, FilterChips, NoMatch, SearchField, StatusMark, type ChipOption } from "@/components/studio-kit";
import { useAsync } from "@/components/use-async";
import { fetchMailOverview, type MailFile } from "@/features/artist-mail/api";
import {
  changeGiftSend,
  createGiftSend,
  testStatusMail,
  type GiftMailSend,
  type GiftMailSendInput,
  type GiftRecipientStatus,
  type GiftSendPurpose,
  type StatusMails,
} from "@/features/gifts/api";
import { ALL_FILL_KEYS, GIFT_UPDATE_FILL_INS, unfilledMarks, unknownFillIns } from "@/lib/artist-mail-view";
import { friendlyError } from "@/lib/error-copy";
import type { StatusTone } from "@/lib/format/status";
import { PURPOSE_HINT, PURPOSE_LABEL, PURPOSES, guessPurpose, reach, sendButtonLabel, sendPromise, sentLine } from "@/lib/gift-send-view";
import { giftTemplates, otherTemplates } from "@/lib/gift-status-mail-templates";
import { buttonProblem, previewValues, sendingVersion } from "@/lib/gift-status-mail-view";
import { RECIPIENT_STATUS_LABEL, RECIPIENT_STATUSES } from "@/lib/gifts-view";
import { searchList, shownCount } from "@/lib/list-search-view";

import type { Notice } from "./status-emails";

const TONE: Record<GiftRecipientStatus, StatusTone> = {
  YET_TO_SEND: "neutral",
  PREPARED: "accent",
  DISPATCHED: "info",
  RECEIVED: "positive",
  RETURNED: "warning",
  MISSING: "negative",
};

type PeopleFilter = GiftRecipientStatus | "ALL" | "PICKED";

export function GiftSendComposer({
  mails,
  start,
  onDone,
  onCancel,
}: {
  mails: StatusMails;
  /** A request to change (sent back or waiting), or the people ticked in Collectibles. */
  start: { send?: GiftMailSend; picked?: string[] };
  onDone: (next: StatusMails, notice: Notice) => void;
  onCancel: () => void;
}) {
  const campaignId = mails.campaign.id;
  const atOnce = Boolean(mails.approves_at_once);
  const people = mails.people;
  const initialPicked = start.send?.recipient_ids ?? start.picked ?? [];
  const [picked, setPicked] = useState<Set<string>>(new Set(initialPicked));
  const [purpose, setPurpose] = useState<GiftSendPurpose>(
    start.send?.purpose ?? guessPurpose(people.filter((p) => initialPicked.includes(p.id)).map((p) => p.status)),
  );
  const firstVersion = (p: GiftSendPurpose) => {
    if (p === "OTHER") {
      const t = otherTemplates(mails.profile.kind === "band" ? "we" : "I", typeof window === "undefined" ? "" : window.location.origin)[0];
      return { subject: t.subject, body: t.body, button_label: null, button_url: null, file_ids: [] as string[] };
    }
    const item = mails.items.find((i) => i.status === p);
    return item ? sendingVersion(item) : { subject: "", body: "", button_label: null, button_url: null, file_ids: [] as string[] };
  };
  const [words, setWords] = useState(() =>
    start.send
      ? { subject: start.send.subject, body: start.send.body, button_label: start.send.button_label, button_url: start.send.button_url, file_ids: start.send.file_ids }
      : firstVersion(purpose),
  );
  const [touched, setTouched] = useState(Boolean(start.send));
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<PeopleFilter>(initialPicked.length ? "PICKED" : "ALL");
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [busy, setBusy] = useState<"send" | "test" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const overview = useAsync(() => fetchMailOverview(mails.profile), [mails.profile.kind, mails.profile.id]);
  const [files, setFiles] = useState<MailFile[] | null>(null);
  const allFiles = files ?? (overview.status === "ok" ? overview.data.files : []);

  const voice = mails.profile.kind === "band" ? "we" : "I";
  const web = typeof window === "undefined" ? "" : window.location.origin;
  const templates = useMemo(() => {
    if (purpose === "OTHER") return otherTemplates(voice, web);
    const item = mails.items.find((i) => i.status === purpose);
    const inUse = item ? sendingVersion(item) : null;
    const own = inUse ? [{ id: "in-use", label: item?.live ? "Your automatic email" : "Corner Room's wording", subject: inUse.subject, body: inUse.body, button: inUse.button_label && inUse.button_url ? { label: inUse.button_label, url: inUse.button_url } : null }] : [];
    return [...own, ...giftTemplates(purpose, voice, web)];
  }, [purpose, voice, web, mails.items]);

  const pickedPeople = people.filter((p) => picked.has(p.id));
  const { gets, skipped } = reach(purpose, pickedPeople);
  const filtered = filter === "ALL" ? people : filter === "PICKED" ? pickedPeople : people.filter((p) => p.status === filter);
  const listed = searchList(filtered, query, (p) => [p.name]);
  const listedIds = listed.map((p) => p.id);
  const allListed = listedIds.length > 0 && listedIds.every((id) => picked.has(id));
  const someListed = listedIds.some((id) => picked.has(id));
  const previewPerson = gets.find((p) => p.id === previewId) ?? gets[0] ?? pickedPeople[0] ?? null;
  const values = previewValues(previewPerson, mails.artist, mails.music, mails.campaign.gift_items);

  const counts: Partial<Record<GiftRecipientStatus, number>> = {};
  for (const p of people) counts[p.status] = (counts[p.status] ?? 0) + 1;
  const chips: ChipOption<PeopleFilter>[] = [
    { key: "PICKED", label: "Picked", count: picked.size },
    { key: "ALL", label: "Everyone", count: people.length },
    ...RECIPIENT_STATUSES.filter((s) => counts[s]).map((s) => ({ key: s as PeopleFilter, label: RECIPIENT_STATUS_LABEL[s], count: counts[s] ?? 0, dot: TONE[s] })),
  ];

  const marks = unfilledMarks(`${words.subject}\n${words.body}\n${words.button_label ?? ""}`);
  const typos = unknownFillIns(`${words.subject}\n${words.body}`, ALL_FILL_KEYS);
  const buttonIssue = buttonProblem(words.button_label, words.button_url);
  const ready = Boolean(words.subject.trim() && words.body.trim()) && !marks.length && !typos.length && !buttonIssue && pickedPeople.length > 0;
  const set = (patch: Partial<typeof words>) => {
    setTouched(true);
    setWords((w) => ({ ...w, ...patch }));
  };
  const payload = (): GiftMailSendInput => ({
    purpose,
    subject: words.subject,
    body: words.body,
    button_label: words.button_label?.trim() || null,
    button_url: words.button_url?.trim() || null,
    file_ids: words.file_ids,
    recipient_ids: pickedPeople.map((p) => p.id),
  });
  const flip = (id: string) =>
    setPicked((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function send() {
    setBusy("send");
    setProblem(null);
    try {
      const next = start.send ? await changeGiftSend(campaignId, start.send.id, payload()) : await createGiftSend(campaignId, payload());
      onDone(next, {
        tone: atOnce ? ((next.sent ?? 0) > 0 ? "success" : "problem") : "info",
        text: start.send ? "Changed and sent to Corner Room again. Nobody was emailed." : sentLine(atOnce, next.sent, next.skipped),
      });
    } catch (err) {
      setProblem(friendlyError(err, "That didn't go through. Nobody was emailed. Please try again."));
    } finally {
      setBusy(null);
    }
  }

  async function test() {
    setBusy("test");
    setProblem(null);
    try {
      const status = purpose === "OTHER" ? "DISPATCHED" : purpose;
      const { sent_to } = await testStatusMail(campaignId, status, { ...payload(), recipient_id: previewPerson?.id ?? null });
      onDone(mails, {
        tone: "success",
        text: `Test sent to you at ${sent_to}${previewPerson?.name ? `, written as ${previewPerson.name} will see it` : ""}. No buyer was emailed.`,
      });
    } catch (err) {
      setProblem(friendlyError(err, "The test didn't go through."));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="cr-cut cr-glass-card sk-appear grid gap-6 p-5 sm:p-6" aria-labelledby="gs-title">
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="sk-kicker">{start.send ? "Change and send again" : "New email"}</p>
          <h4 id="gs-title" className="mt-1 text-lg font-bold text-fg">
            Email buyers you pick
          </h4>
          <p className="mt-1 max-w-2xl text-sm text-fg-muted">{sendPromise(atOnce)}</p>
        </div>
        <button type="button" className="sk-clear cr-focus" aria-label="Close without sending" onClick={onCancel}>
          <X aria-hidden="true" className="size-5" />
        </button>
      </header>

      {/* 1. What it's about */}
      <fieldset className="grid gap-2">
        <legend className="text-[0.8125rem] font-semibold text-fg">1. What it&apos;s about</legend>
        <div className="sk-chips" role="group" aria-label="What the email is about">
          {PURPOSES.map((p) => (
            <button
              key={p}
              type="button"
              className="sk-chip cr-cut cr-focus"
              aria-pressed={purpose === p}
              onClick={() => {
                setPurpose(p);
                if (!touched) setWords(firstVersion(p));
              }}
            >
              {PURPOSE_LABEL[p]}
            </button>
          ))}
        </div>
        <p className="text-sm text-fg-muted">{PURPOSE_HINT[purpose]}</p>
      </fieldset>

      {/* 2. Who gets it */}
      <fieldset className="grid gap-3">
        <legend className="flex items-center gap-2 text-[0.8125rem] font-semibold text-fg">
          <Users aria-hidden="true" className="size-4 text-highlight" /> 2. Who gets it
        </legend>
        <FilterChips<PeopleFilter> label="Show people" options={chips} value={filter} onChange={setFilter} />
        <div className="flex flex-wrap items-center gap-3">
          <SearchField className="min-w-[12rem] flex-1" value={query} onChange={setQuery} label="Search buyers by name" placeholder="Search buyers by name" />
          <label className="flex items-center gap-2 text-sm font-semibold text-fg">
            <Check
              label="Pick everyone shown"
              checked={allListed}
              indeterminate={someListed}
              onChange={(on) => setPicked((s) => (on ? new Set([...s, ...listedIds]) : new Set([...s].filter((id) => !listedIds.includes(id)))))}
            />
            Everyone shown ({shownCount(listed.length, filtered.length)})
          </label>
        </div>
        {query && !listed.length ? (
          <NoMatch query={query} onClear={() => setQuery("")} />
        ) : listed.length === 0 ? (
          <p className="text-sm text-fg-muted">{filter === "PICKED" ? "Nobody picked yet. Choose Everyone to pick people." : "Nobody here."}</p>
        ) : (
          <ul className="grid max-h-72 gap-1 overflow-auto pr-1">
            {listed.slice(0, 500).map((p) => (
              <li key={p.id}>
                <label className="gm-person cursor-pointer" data-chosen={picked.has(p.id)}>
                  <span className="flex min-w-0 items-center gap-3 text-sm text-fg">
                    <Check label={`Pick ${p.name || "this buyer"}`} checked={picked.has(p.id)} onChange={() => flip(p.id)} />
                    <span className="truncate">{p.name || "A buyer with no name on file"}</span>
                  </span>
                  <span className="flex items-center gap-3 text-xs">
                    {!p.reachable ? <span className="text-fg-muted">No email</span> : null}
                    <StatusMark tone={TONE[p.status]}>{RECIPIENT_STATUS_LABEL[p.status]}</StatusMark>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
        <p className="text-sm text-fg" aria-live="polite">
          <span className="font-semibold">{gets.length}</span> {gets.length === 1 ? "buyer gets" : "buyers get"} it
          {skipped.length ? (
            <span className="text-fg-muted">
              {" "}
              · {skipped.length} picked won&apos;t ({purpose === "OTHER" ? "no email address" : `their gift isn't ${RECIPIENT_STATUS_LABEL[purpose as GiftRecipientStatus].toLowerCase()} or they have no email`})
            </span>
          ) : null}
        </p>
      </fieldset>

      {/* 3. The words, beside the email as one of them will read it */}
      <fieldset className="grid gap-4">
        <legend className="flex items-center gap-2 text-[0.8125rem] font-semibold text-fg">
          <Sparkles aria-hidden="true" className="size-4 text-highlight" /> 3. The words
        </legend>
        <div className="am-chips" role="group" aria-label="Start from a template">
          {templates.map((t) => (
            <button
              key={t.id}
              type="button"
              className="am-occasion cr-focus"
              aria-pressed={words.subject === t.subject && words.body === t.body}
              onClick={() => set({ subject: t.subject, body: t.body, button_label: t.button?.label ?? null, button_url: t.button?.url ?? null })}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="grid content-start gap-4">
            <RichEditor label="Subject" singleLine value={words.subject} onChange={(subject) => set({ subject })} values={values} fillIns={GIFT_UPDATE_FILL_INS} />
            <RichEditor label="Message" value={words.body} onChange={(body) => set({ body })} values={values} fillIns={GIFT_UPDATE_FILL_INS} />
            <p className="text-xs text-fg-muted">Highlighted words change for each buyer. Select words and tap Link to add a link. Write in any language.</p>
            <fieldset className="grid gap-2">
              <legend className="flex items-center gap-2 text-[0.8125rem] font-semibold text-fg">
                <MousePointerClick aria-hidden="true" className="size-4 text-highlight" /> Button (optional)
              </legend>
              <div className="grid gap-2 sm:grid-cols-2">
                <Input aria-label="Button words" placeholder="For example: Track your parcel" value={words.button_label ?? ""} maxLength={80} onChange={(e) => set({ button_label: e.target.value })} />
                <Input aria-label="Button link" placeholder="https://" inputMode="url" value={words.button_url ?? ""} onChange={(e) => set({ button_url: e.target.value })} />
              </div>
              {buttonIssue ? <p className="text-sm text-danger">{buttonIssue}</p> : null}
            </fieldset>
            {overview.status === "ok" ? (
              <FilesPicker
                profile={mails.profile}
                files={allFiles}
                onFiles={setFiles}
                value={words.file_ids}
                onChange={(file_ids) => set({ file_ids })}
                maxBytes={overview.data.file_max_bytes}
              />
            ) : null}
          </div>
          <div className="grid content-start gap-3">
            {gets.length > 1 ? (
              <label className="grid gap-1 text-[0.8125rem] font-semibold text-fg">
                Preview as
                <select
                  className="cr-focus min-h-10 border border-line-strong bg-surface-sunken px-3 text-sm text-fg"
                  value={previewPerson?.id ?? ""}
                  onChange={(e) => setPreviewId(e.target.value)}
                >
                  {gets.slice(0, 500).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name || "A buyer with no name on file"}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <MailPreview
              artist={mails.artist}
              subject={words.subject}
              body={words.body}
              values={values}
              kind="GIFT_UPDATE"
              button={words.button_label && words.button_url ? { label: words.button_label, url: words.button_url } : null}
              files={allFiles.filter((f) => words.file_ids.includes(f.id))}
            />
          </div>
        </div>
      </fieldset>

      {marks.length || typos.length || problem ? (
        <div className="grid gap-1">
          {marks.length ? (
            <p role="alert" className="flex items-center gap-2 text-sm text-danger">
              <CircleAlert aria-hidden="true" className="size-4" /> Fill in {marks.join(", ")} first.
            </p>
          ) : null}
          {typos.length ? <p className="text-sm text-danger">{typos.join(", ")} won&apos;t be filled in. Use the buttons above the message.</p> : null}
          {problem ? (
            <p role="alert" className="flex items-center gap-2 text-sm text-danger">
              <CircleAlert aria-hidden="true" className="size-4" /> {problem}
            </p>
          ) : null}
        </div>
      ) : null}

      <footer className="flex flex-wrap items-center gap-3 border-t border-line pt-5">
        <Button className="sk-gloss cr-cut" busy={busy === "send"} disabled={!ready || busy !== null} onClick={() => void send()}>
          {atOnce ? <Send aria-hidden="true" /> : <SendHorizontal aria-hidden="true" />} {sendButtonLabel(atOnce, pickedPeople.length)}
        </Button>
        <Button variant="ghost" busy={busy === "test"} disabled={!words.subject.trim() || !words.body.trim() || Boolean(buttonIssue) || busy !== null} onClick={() => void test()}>
          <Send aria-hidden="true" /> Send me a test
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={busy !== null}>
          Cancel
        </Button>
        {!pickedPeople.length ? <span className="text-sm text-fg-muted">Pick at least one buyer.</span> : null}
      </footer>
    </section>
  );
}
