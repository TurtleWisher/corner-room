"use client";

/*
 * One music gift (owner, 2026-11-06, D-GIFT-MUSIC-01). A draft opens in the composer. Waiting for
 * Corner Room (or for its time) it can be taken back to change. Once given, a report per person:
 * has it now, emailed and waiting to sign up, or already had it; whether the email went and how
 * often its links were opened; a CSV of it all. Any gift can be copied to give again.
 */

import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, CircleAlert, Copy, Download, Trash2, Undo2 } from "lucide-react";

import { MailPreview } from "@/components/artist-mail/mail-preview";
import { Button, ButtonLink, Card, ErrorState, Input, Skeleton } from "@/components/ds";
import { GiftTabs } from "@/components/gifts/gift-tabs";
import { GiftComposer } from "@/components/music-gifts/gift-composer";
import { AccountPage } from "@/components/shell/account-page";
import { RetryButton } from "@/components/shell/staff-panel";
import { loadErrorMessage, useAsync } from "@/components/use-async";
import { fetchMailOverview, type MailFile } from "@/features/artist-mail/api";
import {
  copyMusicGift,
  discardMusicGift,
  fetchGiftSuggestions,
  fetchMusicGift,
  withdrawMusicGift,
  type MusicGiftDetail,
  type MusicGiftPersonStatus,
} from "@/features/music-gifts/api";
import { fetchProfileReleases } from "@/features/studio/api";
import { ApiError } from "@/lib/api/client";
import { valuesFor, whenLine } from "@/lib/artist-mail-view";
import { worksLine } from "@/lib/gifts-view";
import { EMAIL_STATUS_LABEL, GIFT_STATUS_LABEL, PERSON_STATUS_LABEL, reportCsv } from "@/lib/music-gift-view";

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function Tiles({ g }: { g: MusicGiftDetail }) {
  const tiles = [
    { label: "People", value: g.counts.TOTAL },
    { label: "Have it now", value: g.counts.GIVEN },
    { label: "Waiting to sign up", value: g.counts.WAITING_ACCOUNT },
    { label: "Already had it", value: g.counts.ALREADY_OWNED },
  ];
  return (
    <dl className="grid gap-3 sm:grid-cols-4">
      {tiles.map((t) => (
        <Card key={t.label} className="p-4">
          <dt className="text-sm text-fg-muted">{t.label}</dt>
          <dd className="cr-num mt-1 text-3xl font-bold text-fg">{t.value}</dd>
        </Card>
      ))}
    </dl>
  );
}

function Report({ g }: { g: MusicGiftDetail }) {
  const [query, setQuery] = useState("");
  const [only, setOnly] = useState<MusicGiftPersonStatus | "ALL">("ALL");
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return g.people.filter((p) => (only === "ALL" || p.status === only) && (!q || p.email.includes(q) || (p.name ?? "").toLowerCase().includes(q)));
  }, [g.people, query, only]);
  return (
    <Card as="section" aria-labelledby="gift-report" className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id="gift-report" className="text-lg font-bold text-fg">
          Who has it
        </h3>
        <Button size="sm" variant="secondary" onClick={() => download(`${g.title.replace(/[^\w-]+/g, "-") || "music-gift"}.csv`, reportCsv(g.people))}>
          <Download aria-hidden="true" /> Download CSV
        </Button>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Input className="w-auto" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a person" aria-label="Find a person" />
        <select
          className="cr-focus min-h-10 border border-line-strong bg-surface-sunken px-3 text-sm text-fg"
          value={only}
          onChange={(e) => setOnly(e.target.value as MusicGiftPersonStatus | "ALL")}
          aria-label="Show"
        >
          <option value="ALL">Everyone</option>
          {(Object.keys(PERSON_STATUS_LABEL) as MusicGiftPersonStatus[]).map((s) => (
            <option key={s} value={s}>
              {PERSON_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[40rem] text-left text-sm">
          <thead>
            <tr className="border-b border-line text-fg-muted">
              <th scope="col" className="py-2 pr-3 font-semibold">
                Person
              </th>
              <th scope="col" className="py-2 pr-3 font-semibold">
                Music
              </th>
              <th scope="col" className="py-2 pr-3 font-semibold">
                Email
              </th>
              <th scope="col" className="py-2 text-right font-semibold">
                Link clicks
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((p) => (
              <tr key={p.id} className="border-b border-line align-top">
                <td className="py-2 pr-3 text-fg">
                  <span className="block font-semibold">{p.name ?? p.email}</span>
                  {p.name ? <span className="block text-fg-muted">{p.email}</span> : null}
                  {p.note ? <span className="mt-0.5 block text-xs text-fg-muted">Note: {p.note}</span> : null}
                </td>
                <td className="py-2 pr-3 text-fg">{PERSON_STATUS_LABEL[p.status]}</td>
                <td className="py-2 pr-3 text-fg">{p.email_status ? EMAIL_STATUS_LABEL[p.email_status] : "Not sent yet"}</td>
                <td className="cr-num py-2 text-right text-fg">{p.clicks}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {shown.length === 0 ? <p className="mt-3 text-sm text-fg">Nobody matches.</p> : null}
      </div>
    </Card>
  );
}

function Draft({ g, onSaved }: { g: MusicGiftDetail; onSaved: (note: string) => void }) {
  const kind = g.profile.kind;
  const setup = useAsync(async () => {
    const [overview, releases, suggestions] = await Promise.all([
      fetchMailOverview({ kind, id: g.profile.id }),
      fetchProfileReleases(kind, g.profile.id),
      fetchGiftSuggestions(kind, g.profile.id).catch(() => []),
    ]);
    return { overview, releases, suggestions };
  }, [kind, g.profile.id]);
  const [files, setFiles] = useState<MailFile[]>([]);
  useEffect(() => {
    if (setup.status === "ok") setFiles(setup.data.overview.files);
  }, [setup.status, setup.data]);
  if (setup.status === "loading") return <Skeleton className="h-64 w-full" />;
  if (setup.status === "error") {
    return <ErrorState title="Couldn't open the gift form" message={loadErrorMessage(setup.error, "your music")} action={<RetryButton onClick={setup.reload} />} />;
  }
  return (
    <Card className="p-5">
      <GiftComposer
        profile={{ kind, id: g.profile.id }}
        artist={g.profile.display_name}
        voice={kind === "band" ? "we" : "I"}
        releases={setup.data.releases}
        files={files}
        onFiles={setFiles}
        fileMaxBytes={setup.data.overview.file_max_bytes}
        suggestions={setup.data.suggestions}
        start={g}
        onDone={onSaved}
      />
    </Card>
  );
}

function Gift({ id }: { id: string }) {
  const router = useRouter();
  const data = useAsync(() => fetchMusicGift(id), [id]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  if (data.status === "loading") return <Skeleton className="h-64 w-full" />;
  if (data.status === "error") {
    return <ErrorState title="Gift unavailable" message={loadErrorMessage(data.error, "this gift")} action={<RetryButton onClick={data.reload} />} />;
  }
  const g = data.data;
  const first = g.people[0] ?? null;

  async function run(key: string, fn: () => Promise<unknown>, after?: (result: unknown) => void) {
    setBusy(key);
    setError(null);
    try {
      const result = await fn();
      if (after) after(result);
      else data.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That didn't go through. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid gap-6">
      <div>
        <p className="text-sm font-semibold text-highlight">{GIFT_STATUS_LABEL[g.status] ?? g.status}</p>
        <h2 className="mt-1 text-2xl font-bold text-fg">{g.title}</h2>
        <p className="mt-1 text-sm text-fg">
          {g.profile.display_name} · {g.works.length ? worksLine(g.works) : "No music chosen yet"}
        </p>
        {g.status === "IN_REVIEW" ? <p className="mt-2 text-sm text-fg">Waiting for Corner Room to check it. Nothing is given or sent until it is approved.</p> : null}
        {g.status === "SCHEDULED" && g.send_at ? <p className="mt-2 text-sm text-fg">Approved. The music is given {whenLine(g.send_at)}.</p> : null}
        {g.status === "SENT" && g.sent_at ? (
          <p className="mt-2 text-sm text-fg">Given {whenLine(g.sent_at)}. Anyone still to sign up gets it as soon as they do, with the address you used.</p>
        ) : null}
      </div>

      {g.review_note ? (
        <p className="flex items-start gap-2 text-sm text-danger">
          <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" /> Corner Room asked for a change: {g.review_note}
        </p>
      ) : null}
      {note ? (
        <p role="status" className="text-sm text-fg">
          {note}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {g.status === "IN_REVIEW" || g.status === "SCHEDULED" ? (
          <Button size="sm" variant="secondary" busy={busy === "withdraw"} onClick={() => void run("withdraw", () => withdrawMusicGift(g.id))}>
            <Undo2 aria-hidden="true" /> Take it back to change
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="ghost"
          busy={busy === "copy"}
          onClick={() => void run("copy", () => copyMusicGift(g.id), (copy) => router.push(`/studio/gifts/music/${(copy as MusicGiftDetail).id}`))}
        >
          <Copy aria-hidden="true" /> {g.status === "SENT" ? "Give again" : "Copy"}
        </Button>
        {g.status === "DRAFT" ? (
          confirmDiscard ? (
            <>
              <Button
                size="sm"
                variant="danger"
                busy={busy === "discard"}
                onClick={() => void run("discard", () => discardMusicGift(g.id), () => router.push("/studio/gifts/music"))}
              >
                <Trash2 aria-hidden="true" /> Yes, throw it away
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmDiscard(false)}>
                Keep it
              </Button>
            </>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setConfirmDiscard(true)}>
              <Trash2 aria-hidden="true" /> Throw away this draft
            </Button>
          )
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="flex items-center gap-2 text-sm text-danger">
          <CircleAlert aria-hidden="true" className="size-4" /> {error}
        </p>
      ) : null}

      {g.status === "DRAFT" ? (
        <Draft
          key={`${g.id}|${g.created_at}`}
          g={g}
          onSaved={(text) => {
            setNote(text);
            data.reload();
          }}
        />
      ) : (
        <>
          {g.status === "SENT" ? <Tiles g={g} /> : null}
          {g.status === "SENT" ? (
            <Report g={g} />
          ) : (
            <Card as="section" aria-label="People on this gift" className="p-5">
              <h3 className="text-lg font-bold text-fg">
                {g.counts.TOTAL} {g.counts.TOTAL === 1 ? "person" : "people"}
              </h3>
              <ul className="mt-2 max-h-72 overflow-y-auto text-sm text-fg">
                {g.people.map((p) => (
                  <li key={p.id} className="border-b border-line py-1.5">
                    {p.name ? `${p.name} · ` : ""}
                    {p.email}
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <Card as="section" aria-label="The email" className="p-5">
            <h3 className="mb-3 text-lg font-bold text-fg">The email</h3>
            <MailPreview
              artist={g.profile.display_name}
              subject={g.subject}
              body={g.body}
              values={valuesFor(first?.name ?? null, g.works.map((w) => w.title), g.profile.display_name)}
              kind="GIFT"
              work={g.works[0] ?? null}
              files={g.files}
              note={first?.note ?? null}
            />
          </Card>
        </>
      )}
    </div>
  );
}

export default function StudioMusicGiftPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <AccountPage
      audience="artist"
      eyebrow="Studio"
      title="Gifts"
      what="this music gift"
      actions={
        <ButtonLink href="/studio/gifts/music" variant="secondary">
          <ArrowLeft aria-hidden="true" /> All music gifts
        </ButtonLink>
      }
    >
      <GiftTabs current="music" />
      <Gift id={id} />
    </AccountPage>
  );
}
