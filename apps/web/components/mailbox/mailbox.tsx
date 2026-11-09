"use client";

/*
 * The artist's Mailbox (owner, 2026-11-09, D-MAILBOX-01, /studio/mailbox): one corner for every
 * email Corner Room sends for an act, laid out like a mail app.
 *
 *   Sent       every email to each person: when, to whom (names only), why and whether it went
 *   Waiting    drafts, emails with Corner Room, scheduled ones, and gift emails that need you
 *   Write      a new email to buyers (Corner Room checks each one before it goes)
 *   Automatic  thank-yous after a purchase, and each gift campaign's automatic emails
 *   Templates  saved emails to start from
 *   Report     reach and link presses
 *
 * The folder sits in `?box=` and the act in `?act=kind:id`. Every email is written and sent by the
 * server; this page only shows and asks.
 */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart3, Bookmark, ChevronRight, Clock3, Gift, Inbox, PenSquare, Repeat2, Send, Trash2 } from "lucide-react";

import { MailComposer, type ComposerStart } from "@/components/artist-mail/mail-composer";
import { ActMailReport } from "@/components/artist-mail/mail-reports";
import { ThankYouSection } from "@/components/artist-mail/thank-you-section";
import { Button, EmptyState, ErrorState, Skeleton } from "@/components/ds";
import { Banner, type Notice } from "@/components/gifts/status-emails";
import { RetryButton } from "@/components/shell/staff-panel";
import { NoMatch, SearchField, StatusMark } from "@/components/studio-kit";
import { loadErrorMessage, useAsync } from "@/components/use-async";
import { deleteMailTemplate, fetchMailbox, fetchMailOverview, fullAudience, type MailFile, type MailProfile } from "@/features/artist-mail/api";
import { fetchGiftCampaigns, type GiftCampaign } from "@/features/gifts/api";
import { fetchMyProfiles, fetchProfileReleases, type CatalogProfile } from "@/features/studio/api";
import { audienceLine } from "@/lib/artist-mail-view";
import { CAMPAIGN_STATUS_LABEL } from "@/lib/gifts-view";
import { searchList } from "@/lib/list-search-view";
import { BOXES, boxFrom, type MailboxBox } from "@/lib/mailbox-view";

import { MailRow } from "./mail-row";
import { SentBox } from "./sent-box";

const ICON: Record<MailboxBox, typeof Inbox> = {
  sent: Send,
  outbox: Clock3,
  write: PenSquare,
  automatic: Repeat2,
  templates: Bookmark,
  report: BarChart3,
};

function actKey(p: Pick<CatalogProfile, "kind" | "id">): string {
  return `${p.kind}:${p.id}`;
}

function setQuery(patch: Record<string, string | null>) {
  const url = new URL(window.location.href);
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) url.searchParams.delete(k);
    else url.searchParams.set(k, v);
  }
  window.history.replaceState(null, "", url.pathname + (url.search ? url.search : "") + url.hash);
}

export function Mailbox() {
  const profiles = useAsync(() => fetchMyProfiles(), []);
  const [box, setBox] = useState<MailboxBox>("sent");
  const [act, setAct] = useState<string | null>(null);
  useEffect(() => {
    setBox(boxFrom(window.location.search));
    setAct(new URLSearchParams(window.location.search).get("act"));
  }, []);
  const go = useCallback((next: MailboxBox) => {
    setBox(next);
    setQuery({ box: next === "sent" ? null : next });
  }, []);

  if (profiles.status === "loading") return <Skeleton className="h-96 w-full" />;
  if (profiles.status === "error") {
    return <ErrorState title="Mailbox unavailable" message={loadErrorMessage(profiles.error, "your profiles")} action={<RetryButton onClick={profiles.reload} />} />;
  }
  const acts = profiles.data.filter((p) => p.kind === "artist" || p.kind === "band");
  if (acts.length === 0) {
    return <EmptyState title="No artist or band profile yet" body="The Mailbox is for the artist and band profiles you publish for in Studio." />;
  }
  const current = acts.find((p) => actKey(p) === act) ?? acts[0];
  return (
    <ActMailbox
      key={actKey(current)}
      acts={acts}
      current={current}
      box={box}
      onBox={go}
      onAct={(p) => {
        setAct(actKey(p));
        setQuery({ act: actKey(p) });
      }}
    />
  );
}

function ActMailbox({
  acts,
  current,
  box,
  onBox,
  onAct,
}: {
  acts: CatalogProfile[];
  current: CatalogProfile;
  box: MailboxBox;
  onBox: (b: MailboxBox) => void;
  onAct: (p: CatalogProfile) => void;
}) {
  const profile: MailProfile = useMemo(() => ({ kind: current.kind as "artist" | "band", id: current.id }), [current.kind, current.id]);
  const overview = useAsync(() => fetchMailOverview(profile), [profile]);
  const releases = useAsync(() => fetchProfileReleases(profile.kind, profile.id), [profile]);
  const campaigns = useAsync(() => fetchGiftCampaigns(profile.kind, profile.id), [profile]);
  const sentTotal = useAsync(async () => {
    const b = await fetchMailbox(profile, { limit: 1 });
    return Object.values(b.totals).reduce((a, n) => a + n, 0);
  }, [profile]);
  const [composing, setComposing] = useState<ComposerStart | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [files, setFiles] = useState<MailFile[] | null>(null);

  const artist = current.display_name;
  const voice = profile.kind === "band" ? "we" : "I";
  const mails = overview.status === "ok" ? overview.data.mails : [];
  const waitingMails = mails.filter((m) => m.status !== "SENT");
  const giftList: GiftCampaign[] = campaigns.status === "ok" ? campaigns.data : [];
  const giftNeeds = giftList.filter((c) => (c.sends_ready ?? 0) > 0 || (c.sends_waiting ?? 0) > 0 || (c.emails_waiting ?? 0) > 0);
  const waitingCount = waitingMails.length + giftNeeds.reduce((n, c) => n + (c.sends_ready ?? 0) + (c.sends_waiting ?? 0) + (c.emails_waiting ?? 0), 0);
  const counts: Partial<Record<MailboxBox, number | null>> = {
    sent: sentTotal.status === "ok" ? sentTotal.data : null,
    outbox: waitingCount || null,
    templates: overview.status === "ok" ? overview.data.templates.length || null : null,
  };

  const done = (text: string) => {
    setComposing(null);
    setNotice({ tone: "success", text });
    overview.reload();
    if (box === "write") onBox("outbox");
  };

  return (
    <div className="mb-shell">
      <nav aria-label="Mailbox folders" className="grid content-start gap-3">
        {acts.length > 1 ? (
          <label className="grid gap-1 text-xs font-semibold uppercase tracking-wider text-fg-muted">
            Mail for
            <select
              className="cr-focus h-11 border border-line-strong bg-surface-sunken px-3 text-sm font-semibold normal-case tracking-normal text-fg"
              value={actKey(current)}
              onChange={(e) => {
                const next = acts.find((p) => actKey(p) === e.target.value);
                if (next) onAct(next);
              }}
            >
              {acts.map((p) => (
                <option key={actKey(p)} value={actKey(p)}>
                  {p.display_name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
            Mail for <span className="block pt-1 text-sm normal-case tracking-normal text-fg">{artist}</span>
          </p>
        )}
        <Button className="sk-gloss cr-cut mb-compose hidden lg:inline-flex" onClick={() => onBox("write")}>
          <PenSquare aria-hidden="true" /> Write an email
        </Button>
        <div className="mb-rail">
          {BOXES.map((b) => {
            const Icon = ICON[b.key];
            const n = counts[b.key];
            return (
              <button key={b.key} type="button" className="mb-folder cr-cut cr-focus" aria-current={box === b.key ? "page" : undefined} title={b.hint} onClick={() => onBox(b.key)}>
                <Icon aria-hidden="true" /> {b.label}
                {n ? <span className="sk-count">{n}</span> : null}
              </button>
            );
          })}
        </div>
      </nav>

      <div className="grid min-w-0 content-start gap-5">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="sk-kicker">{artist}</p>
            <h2 className="mt-1 text-2xl font-bold text-fg">{BOXES.find((b) => b.key === box)?.label}</h2>
            <p className="mt-1 text-sm text-fg-muted">{BOXES.find((b) => b.key === box)?.hint}. Buyers are names only; Corner Room sends every email from &ldquo;{artist} via Corner Room&rdquo;.</p>
          </div>
        </header>
        <Banner notice={notice} onClose={() => setNotice(null)} />

        {box === "sent" ? <SentBox profile={profile} artist={artist} /> : null}

        {box === "report" ? (
          <div className="cr-cut cr-glass-card p-5">
            <ActMailReport profile={profile} />
          </div>
        ) : null}

        {box !== "sent" && box !== "report" ? (
          overview.status === "loading" || releases.status === "loading" ? (
            <Skeleton className="h-64 w-full" />
          ) : overview.status === "error" ? (
            <ErrorState title="Emails unavailable" message={loadErrorMessage(overview.error, "your emails")} action={<RetryButton onClick={overview.reload} />} />
          ) : (
            (() => {
              const data = overview.data;
              const shared = {
                profile,
                artist,
                voice,
                releases: releases.status === "ok" ? releases.data : [],
                files: files ?? data.files,
                onFiles: setFiles,
                fileMaxBytes: data.file_max_bytes,
              } as const;
              if (box === "write" || composing) {
                return (
                  <div className="cr-cut cr-glass-card sk-appear p-5 sm:p-6">
                    <p className="mb-4 text-sm text-fg-muted">
                      Corner Room checks each email before it goes. Every one has a link to stop your emails
                      {data.stopped_count ? `; ${data.stopped_count} ${data.stopped_count === 1 ? "buyer has" : "buyers have"} used it` : ""}.
                      {data.weekly_limit ? ` You can send ${data.weekly_limit} in 7 days.` : ""}
                    </p>
                    <MailComposer key={composing?.draft?.id ?? composing?.template?.id ?? "new"} {...shared} start={composing} onDone={done} />
                  </div>
                );
              }
              if (box === "outbox") {
                return (
                  <div className="grid gap-6">
                    {giftNeeds.length ? (
                      <section aria-labelledby="mb-gifts" className="grid gap-3">
                        <h3 id="mb-gifts" className="flex items-center gap-2 text-lg font-bold text-fg">
                          <Gift aria-hidden="true" className="size-5 text-highlight" /> Gift emails
                        </h3>
                        <ul className="grid gap-2">
                          {giftNeeds.map((c) => (
                            <li key={c.id}>
                              <Link href={`/studio/gifts/${c.id}#emails`} className="gs-card cr-cut cr-glass-card cr-focus flex items-center justify-between gap-3">
                                <span className="min-w-0">
                                  <span className="block truncate font-bold text-fg">{c.title}</span>
                                  <span className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                                    {c.sends_ready ? <StatusMark tone="positive">{c.sends_ready} approved, ready to send</StatusMark> : null}
                                    {c.sends_waiting ? <StatusMark tone="info">{c.sends_waiting} with Corner Room</StatusMark> : null}
                                    {c.emails_waiting ? <StatusMark tone="info">{c.emails_waiting} automatic wording with Corner Room</StatusMark> : null}
                                  </span>
                                </span>
                                <ChevronRight aria-hidden="true" className="size-5 shrink-0 text-fg-muted" />
                              </Link>
                            </li>
                          ))}
                        </ul>
                      </section>
                    ) : null}
                    <section aria-labelledby="mb-waiting" className="grid gap-3">
                      <h3 id="mb-waiting" className="text-lg font-bold text-fg">
                        Emails to buyers
                      </h3>
                      {waitingMails.length ? (
                        <ul className="grid gap-3">
                          {waitingMails.map((m) => (
                            <MailRow key={`${m.id}|${m.status}`} mail={m} onEdit={() => setComposing({ draft: m })} onChanged={(t) => done(t)} />
                          ))}
                        </ul>
                      ) : (
                        <p className="text-sm text-fg-muted">Nothing waiting. Drafts, emails with Corner Room and scheduled ones show here.</p>
                      )}
                    </section>
                    {mails.some((m) => m.status === "SENT") ? (
                      <section aria-labelledby="mb-done" className="grid gap-3">
                        <h3 id="mb-done" className="text-lg font-bold text-fg">
                          Sent emails to buyers
                        </h3>
                        <ul className="grid gap-3">
                          {mails
                            .filter((m) => m.status === "SENT")
                            .map((m) => (
                              <MailRow key={`${m.id}|${m.status}`} mail={m} onEdit={() => setComposing({ draft: m })} onChanged={(t) => done(t)} />
                            ))}
                        </ul>
                      </section>
                    ) : null}
                  </div>
                );
              }
              if (box === "automatic") {
                return (
                  <div className="grid gap-6">
                    <ThankYouSection {...shared} thankYous={data.thank_yous} onChanged={overview.reload} />
                    <section aria-labelledby="mb-auto-gifts" className="grid gap-3">
                      <h3 id="mb-auto-gifts" className="flex items-center gap-2 text-lg font-bold text-fg">
                        <Gift aria-hidden="true" className="size-5 text-highlight" /> Gift campaign emails
                      </h3>
                      <p className="text-sm text-fg-muted">Each campaign emails buyers by itself when a gift is marked Dispatched, Returned or Missing. Open one to change its wording.</p>
                      {giftList.length ? (
                        <ul className="grid gap-2">
                          {giftList.map((c) => (
                            <li key={c.id}>
                              <Link href={`/studio/gifts/${c.id}#emails`} className="cr-row cr-focus flex items-center justify-between gap-3 border-b border-line py-3">
                                <span className="min-w-0">
                                  <span className="block truncate font-semibold text-fg">{c.title}</span>
                                  <span className="text-sm text-fg-muted">
                                    {CAMPAIGN_STATUS_LABEL[c.status] ?? c.status} · {c.gift_items}
                                  </span>
                                </span>
                                <ChevronRight aria-hidden="true" className="size-5 shrink-0 text-fg-muted" />
                              </Link>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-sm text-fg-muted">
                          No gift campaigns yet.{" "}
                          <Link href="/studio/gifts" className="cr-focus font-semibold text-link underline">
                            Set one up
                          </Link>
                          .
                        </p>
                      )}
                    </section>
                  </div>
                );
              }
              return <Templates data={data} onUse={(t) => setComposing({ template: t })} onDeleted={(text) => done(text)} onProblem={(text) => setNotice({ tone: "problem", text })} />;
            })()
          )
        ) : null}
      </div>
    </div>
  );
}

function Templates({
  data,
  onUse,
  onDeleted,
  onProblem,
}: {
  data: Awaited<ReturnType<typeof fetchMailOverview>>;
  onUse: (t: Awaited<ReturnType<typeof fetchMailOverview>>["templates"][number]) => void;
  onDeleted: (text: string) => void;
  onProblem: (text: string) => void;
}) {
  const [query, setQuery] = useState("");
  const list = searchList(data.templates, query, (t) => [t.name, t.subject]);
  if (data.templates.length === 0) {
    return <p className="text-sm text-fg-muted">Write an email and give it a template name to keep it, with who it goes to and its files, for next time.</p>;
  }
  return (
    <div className="grid gap-3">
      {data.templates.length > 4 ? <SearchField value={query} onChange={setQuery} label="Search templates" placeholder="Search templates by name or subject" /> : null}
      {query && !list.length ? <NoMatch query={query} onClear={() => setQuery("")} /> : null}
      <ul className="grid gap-2">
        {list.map((t) => (
          <li key={t.id} className="gs-card cr-cut cr-glass-card flex flex-wrap items-center justify-between gap-3">
            <span className="min-w-0">
              <span className="block font-bold text-fg">{t.name}</span>
              <span className="block truncate text-sm text-fg-muted">
                {t.subject} · {audienceLine(fullAudience(t.audience))}
              </span>
            </span>
            <span className="flex gap-2">
              <Button size="sm" className="sk-gloss cr-cut" onClick={() => onUse(t)}>
                Use
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Delete template ${t.name}`}
                onClick={() =>
                  void deleteMailTemplate(t.id)
                    .then(() => onDeleted(`Template "${t.name}" deleted.`))
                    .catch(() => onProblem(`Template "${t.name}" couldn't be deleted. Try again.`))
                }
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
