"use client";

/*
 * The Mailbox's Sent folder (owner, 2026-11-09, D-MAILBOX-01): every email Corner Room sent for the
 * act, one row per person, newest first and grouped by day. Search (subject, person, campaign or
 * gift; the server searches the whole history), chips by kind and by whether it went, and a
 * reading pane with the email as that person got it (links shown by their labels only), when, why
 * and how many links they pressed. Names only, never addresses.
 */

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ExternalLink, Gift, Inbox, Link2, MousePointerClick, X } from "lucide-react";

import { ErrorState, Skeleton } from "@/components/ds";
import { RetryButton } from "@/components/shell/staff-panel";
import { FilterChips, SearchField, StatusMark, type ChipOption } from "@/components/studio-kit";
import { loadErrorMessage } from "@/components/use-async";
import {
  fetchMailbox,
  fetchMailboxMessage,
  type Mailbox,
  type MailboxItem,
  type MailboxKind,
  type MailboxMessage,
  type MailboxState,
  type MailProfile,
} from "@/features/artist-mail/api";
import { formatDateTime } from "@/lib/format/date";
import { KIND_FILTERS, KIND_LABEL, STATE_LABEL, STATE_MEANING, STATE_TONE, clicksLine, groupByDay, initials, toLine, whyLine } from "@/lib/mailbox-view";
import { SEARCH_DEBOUNCE_MS } from "@/lib/search-view";

type StateFilter = MailboxState | "ANY";
const STATE_FILTERS: ChipOption<StateFilter>[] = [
  { key: "ANY", label: "Any" },
  { key: "SENT", label: "Sent", dot: "positive" },
  { key: "PENDING", label: "On its way", dot: "info" },
  { key: "SUPPRESSED", label: "Not sent", dot: "neutral" },
  { key: "FAILED", label: "Couldn't send", dot: "negative" },
];
const POLL_MS = 5000;
const POLL_TIMES = 12;

function timeOf(iso: string, now: Date): string {
  const at = new Date(iso);
  const sameDay = now.getTime() - at.getTime() < 86_400_000 && now.getDate() === at.getDate();
  return new Intl.DateTimeFormat("en-GB", sameDay ? { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Dhaka" } : { day: "numeric", month: "short", timeZone: "Asia/Dhaka" }).format(at);
}

export function SentBox({ profile, artist }: { profile: MailProfile; artist: string }) {
  const [query, setQuery] = useState("");
  const [typed, setTyped] = useState("");
  const [kind, setKind] = useState<MailboxKind | "ALL">("ALL");
  const [state, setState] = useState<StateFilter>("ANY");
  const [box, setBox] = useState<Mailbox | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [chosen, setChosen] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const polls = useRef(0);

  useEffect(() => {
    const t = window.setTimeout(() => setQuery(typed), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [typed]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    fetchMailbox(profile, { q: query, kinds: kind === "ALL" ? [] : [kind], states: state === "ANY" ? [] : [state], limit: 100 })
      .then((b) => {
        if (alive) setBox(b);
      })
      .catch((err) => {
        if (alive) setError(err);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [profile, query, kind, state, tick]);

  // Emails on their way: ask again shortly so they turn to Sent without a reload.
  useEffect(() => {
    if (!box?.items.some((i) => i.state === "PENDING") || polls.current >= POLL_TIMES) return;
    const t = window.setTimeout(() => {
      polls.current += 1;
      setTick((n) => n + 1);
    }, POLL_MS);
    return () => window.clearTimeout(t);
  }, [box]);

  const now = useMemo(() => new Date(), [box]); // eslint-disable-line react-hooks/exhaustive-deps
  const groups = useMemo(() => groupByDay(box?.items ?? [], now), [box, now]);
  const total = box ? Object.values(box.totals).reduce((a, b) => a + b, 0) : 0;
  const kinds: ChipOption<MailboxKind | "ALL">[] = KIND_FILTERS.filter((k) => k.key === "ALL" || (box?.totals[k.key as MailboxKind] ?? 0) > 0).map((k) => ({
    key: k.key,
    label: k.label,
    count: k.key === "ALL" ? total : (box?.totals[k.key as MailboxKind] ?? 0),
  }));

  async function older() {
    if (!box?.next_before) return;
    setMore(true);
    try {
      const next = await fetchMailbox(profile, {
        q: query,
        kinds: kind === "ALL" ? [] : [kind],
        states: state === "ANY" ? [] : [state],
        before: box.next_before,
        limit: 100,
      });
      setBox({ ...next, items: [...box.items, ...next.items] });
    } finally {
      setMore(false);
    }
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-3">
        <SearchField value={typed} onChange={setTyped} label="Search sent emails" placeholder="Search by person, subject, campaign or gift" shortcut />
        <FilterChips<MailboxKind | "ALL"> label="Show by kind" options={kinds} value={kind} onChange={setKind} />
        <FilterChips<StateFilter> label="Show by delivery" options={STATE_FILTERS} value={state} onChange={setState} />
      </div>

      <div className="mb-panes" data-reading={Boolean(chosen)}>
        <div className={`mb-list ${chosen ? "hidden xl:grid" : "grid"}`} aria-busy={loading}>
          {error && !box ? (
            <ErrorState title="Mailbox unavailable" message={loadErrorMessage(error, "your sent emails")} action={<RetryButton onClick={() => setTick((n) => n + 1)} />} />
          ) : !box ? (
            <Skeleton className="h-72 w-full" />
          ) : box.items.length === 0 ? (
            <div className="grid place-items-center gap-2 py-16 text-center">
              <Inbox aria-hidden="true" className="size-8 text-fg-muted" />
              <p className="font-semibold text-fg">{query || kind !== "ALL" || state !== "ANY" ? "Nothing matches" : "Nothing sent yet"}</p>
              <p className="max-w-sm text-sm text-fg-muted">
                {query || kind !== "ALL" || state !== "ANY"
                  ? "Try other words, or clear the filters."
                  : `Every email Corner Room sends for ${artist}, to each person, will show here.`}
              </p>
            </div>
          ) : (
            <>
              {groups.map((g) => (
                <section key={g.label} aria-label={g.label}>
                  <h3 className="mb-day">{g.label}</h3>
                  <ul>
                    {g.items.map((item) => (
                      <li key={item.id}>
                        <Row item={item} now={now} current={chosen === item.id} onOpen={() => setChosen(item.id)} />
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
              {box.next_before ? (
                <button type="button" className="cr-focus mx-auto my-4 text-sm font-semibold text-link underline" onClick={() => void older()} disabled={more}>
                  {more ? "Loading…" : "Show older emails"}
                </button>
              ) : null}
            </>
          )}
        </div>
        {chosen ? <ReadingPane id={chosen} onClose={() => setChosen(null)} /> : null}
      </div>
    </div>
  );
}

function Row({ item, now, current, onOpen }: { item: MailboxItem; now: Date; current: boolean; onOpen: () => void }) {
  const clicks = clicksLine(item.clicks);
  return (
    <button type="button" className="mb-row cr-focus" aria-current={current} onClick={onOpen}>
      <span className="mb-avatar" data-kind={item.kind} aria-hidden="true">
        {item.kind === "TEST" ? "You" : initials(item.to_name)}
      </span>
      <span className="grid min-w-0 gap-0.5">
        <span className="mb-name">{toLine(item)}</span>
        <span className="mb-subject">{item.subject}</span>
        <span className="mb-why">
          {KIND_LABEL[item.kind]} · {whyLine(item.why)}
        </span>
      </span>
      <span className="grid justify-items-end gap-1">
        <span className="mb-time">{timeOf(item.sent_at ?? item.queued_at, now)}</span>
        <span className="text-xs">
          <StatusMark tone={STATE_TONE[item.state]}>{STATE_LABEL[item.state]}</StatusMark>
        </span>
        {clicks ? (
          <span className="flex items-center gap-1 text-xs text-fg-muted">
            <MousePointerClick aria-hidden="true" className="size-3" /> {item.clicks}
          </span>
        ) : null}
      </span>
    </button>
  );
}

function ReadingPane({ id, onClose }: { id: string; onClose: () => void }) {
  const [message, setMessage] = useState<MailboxMessage | null>(null);
  const [error, setError] = useState<unknown>(null);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    let alive = true;
    setMessage(null);
    setError(null);
    fetchMailboxMessage(id)
      .then((m) => alive && setMessage(m))
      .catch((err) => alive && setError(err));
    return () => {
      alive = false;
    };
  }, [id]);
  useEffect(() => {
    if (message && window.matchMedia?.("(max-width: 1279px)").matches) ref.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [message]);

  return (
    <article ref={ref} key={id} className="mb-reading cr-cut cr-glass-card" aria-label="The email">
      <div className="flex items-center justify-between gap-2">
        <button type="button" className="cr-focus inline-flex items-center gap-1.5 text-sm font-semibold text-fg-muted hover:text-fg xl:hidden" onClick={onClose}>
          <ArrowLeft aria-hidden="true" className="size-4" /> Back to the list
        </button>
        <span className="hidden xl:block" />
        <button type="button" className="sk-clear cr-focus" aria-label="Close the email" onClick={onClose}>
          <X aria-hidden="true" className="size-5" />
        </button>
      </div>
      {error ? (
        <ErrorState title="Email unavailable" message={loadErrorMessage(error, "this email")} />
      ) : !message ? (
        <Skeleton className="mt-3 h-64 w-full" />
      ) : (
        <div className="mt-2 grid gap-5">
          <div>
            <p className="sk-kicker">{KIND_LABEL[message.kind]}</p>
            <h3 className="mt-1 text-xl font-bold text-fg">{message.subject}</h3>
          </div>
          <dl className="mb-meta">
            <dt>From</dt>
            <dd>{message.from_name}</dd>
            <dt>To</dt>
            <dd>{message.kind === "TEST" ? "You (a test)" : message.to_name || "A buyer with no name on file"}</dd>
            <dt>Queued</dt>
            <dd>{formatDateTime(message.queued_at)}</dd>
            {message.sent_at ? (
              <>
                <dt>Sent</dt>
                <dd>{formatDateTime(message.sent_at)}</dd>
              </>
            ) : null}
            <dt>Delivery</dt>
            <dd>
              <StatusMark tone={STATE_TONE[message.state]}>{STATE_LABEL[message.state]}</StatusMark>
              <span className="block text-xs text-fg-muted">{STATE_MEANING[message.state]}</span>
            </dd>
            <dt>Links pressed</dt>
            <dd>{message.clicks || "None yet"}</dd>
          </dl>
          <div className="border-t border-line pt-4">
            <p className="mb-letter">{message.body}</p>
          </div>
          {message.links.length ? (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-fg-muted">Links in it</p>
              <ul className="mt-2 flex flex-wrap gap-2">
                {message.links.map((l, i) => (
                  <li key={i} className="inline-flex items-center gap-1.5 border border-line px-2 py-1 text-xs text-fg">
                    <Link2 aria-hidden="true" className="size-3 text-highlight" /> {l.label || (l.kind === "FILE" ? "A file" : "A link")}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {message.campaign_id ? (
            <Link href={`/studio/gifts/${message.campaign_id}#emails`} className="cr-focus inline-flex items-center gap-2 text-sm font-semibold text-link underline">
              <Gift aria-hidden="true" className="size-4" /> Open the gift campaign <ExternalLink aria-hidden="true" className="size-3.5" />
            </Link>
          ) : message.music_gift_id ? (
            <Link href={`/studio/gifts/music/${message.music_gift_id}`} className="cr-focus inline-flex items-center gap-2 text-sm font-semibold text-link underline">
              <Gift aria-hidden="true" className="size-4" /> Open the music gift
            </Link>
          ) : null}
        </div>
      )}
    </article>
  );
}
