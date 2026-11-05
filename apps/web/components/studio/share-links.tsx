"use client";

/* Share links for a pre-sale (owner, 2026-11-06, D-PRESALE-04): one link per place the artist posts
 * it ("Instagram bio", "Facebook post"), each counting the page opens and Pre-book presses that came
 * through it. Pre-orders are not credited to links (owner: not for now). A link put away keeps
 * counting, so one already posted somewhere keeps its history. */

import { useState } from "react";
import { Archive, Check, CircleAlert, Copy, Link2, Plus } from "lucide-react";

import { Button, Card, ErrorState, Field, Input, Skeleton } from "@/components/ds";
import { loadErrorMessage, useAsync } from "@/components/use-async";
import { addShareLink, archiveShareLink, fetchShareLinks, type ShareLink } from "@/features/presales/api";
import { friendlyError } from "@/lib/error-copy";
import { formatCount } from "@/lib/format/count";

const SUGGESTED = ["Instagram bio", "Facebook post", "WhatsApp", "YouTube description", "Poster QR"];

export function ShareLinks({ releaseId, title }: { releaseId: string; title: string }) {
  const links = useAsync(() => fetchShareLinks(releaseId), [releaseId]);
  const [rows, setRows] = useState<ShareLink[] | null>(null);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current = rows ?? (links.status === "ok" ? links.data : null);

  const run = async (key: string, fn: () => Promise<ShareLink[]>) => {
    setBusy(key);
    setError(null);
    try {
      setRows(await fn());
      if (key === "add") setLabel("");
    } catch (err) {
      setError(friendlyError(err, "That didn't save. Please try again."));
    } finally {
      setBusy(null);
    }
  };

  if (links.status === "loading") return <Skeleton className="h-64 w-full" />;
  if (links.status === "error" && !current) return <ErrorState title="Share links unavailable" message={loadErrorMessage(links.error, "your share links")} />;
  const active = (current ?? []).filter((l) => !l.archived);
  const archived = (current ?? []).filter((l) => l.archived);
  const plain = typeof window === "undefined" ? `/releases/${releaseId}` : `${window.location.origin}/releases/${releaseId}`;

  return (
    <div className="grid gap-8">
      <Card tone="solid" className="p-5">
        <h2 className="flex items-center gap-2 text-base font-bold text-fg">
          <Link2 aria-hidden="true" className="size-4 text-highlight" /> Make a link for each place you post
        </h2>
        <p className="mt-1 text-sm text-fg-muted">
          Every link opens the same pre-sale page for {title}. Its numbers show how many opened the page and pressed Pre-book through it.
          Nothing about the people is kept.
        </p>
        <form
          className="mt-4 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (label.trim()) void run("add", () => addShareLink(releaseId, label.trim()));
          }}
        >
          <Field label="Where you'll post it" className="min-w-64 flex-1">
            {(c) => <Input {...c} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} placeholder="Instagram bio" required />}
          </Field>
          <Button type="submit" busy={busy === "add"} disabled={!label.trim()}>
            <Plus aria-hidden="true" /> Make link
          </Button>
        </form>
        <div className="mt-3 flex flex-wrap gap-2" aria-label="Quick names">
          {SUGGESTED.filter((s) => !active.some((l) => l.label === s)).map((s) => (
            <button key={s} type="button" onClick={() => setLabel(s)} className="cr-focus border border-line px-2.5 py-1 text-xs font-semibold text-fg-muted hover:text-fg">
              {s}
            </button>
          ))}
        </div>
        {error ? (
          <p role="alert" className="mt-3 flex items-start gap-2 text-sm text-danger">
            <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            {error}
          </p>
        ) : null}
      </Card>

      <section aria-labelledby="share-links-title">
        <h2 id="share-links-title" className="text-lg font-bold text-fg">
          Your links
        </h2>
        {active.length === 0 ? (
          <p className="mt-2 text-sm text-fg-muted">No links yet. The plain link works too, it just isn&apos;t counted separately:</p>
        ) : (
          <ul className="mt-3 grid gap-3">
            {active.map((l) => (
              <li key={l.id}>
                <LinkRow link={l} busy={busy === l.id} onArchive={() => void run(l.id, () => archiveShareLink(releaseId, l.id))} />
              </li>
            ))}
          </ul>
        )}
        <p className="mt-4 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-fg-muted">Plain link:</span>
          <code className="break-all text-fg">{plain}</code>
          <CopyButton text={plain} label="Copy the plain link" />
        </p>
      </section>

      {archived.length ? (
        <details>
          <summary className="cr-focus cursor-pointer text-sm font-semibold text-link">Put away ({archived.length})</summary>
          <ul className="mt-3 grid gap-3">
            {archived.map((l) => (
              <li key={l.id}>
                <LinkRow link={l} />
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function LinkRow({ link, busy, onArchive }: { link: ShareLink; busy?: boolean; onArchive?: () => void }) {
  return (
    <Card className="flex flex-wrap items-center gap-x-6 gap-y-3 p-4">
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-fg">{link.label}</p>
        <p className="mt-0.5 break-all text-sm text-fg-muted">{link.url}</p>
      </div>
      <p className="text-sm text-fg">
        <span className="cr-num font-semibold">{formatCount(link.views)}</span> {link.views === 1 ? "open" : "opens"} ·{" "}
        <span className="cr-num font-semibold">{formatCount(link.prebook_clicks)}</span> Pre-book {link.prebook_clicks === 1 ? "press" : "presses"}
      </p>
      <div className="flex gap-2">
        <CopyButton text={link.url} label={`Copy the ${link.label} link`} />
        {onArchive ? (
          <Button variant="ghost" size="sm" busy={busy} onClick={onArchive} aria-label={`Put away the ${link.label} link`}>
            <Archive aria-hidden="true" /> Put away
          </Button>
        ) : null}
      </div>
    </Card>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      variant="secondary"
      size="sm"
      aria-label={label}
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(
          () => {
            setDone(true);
            window.setTimeout(() => setDone(false), 1800);
          },
          () => undefined,
        );
      }}
    >
      {done ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />} {done ? "Copied" : "Copy"}
    </Button>
  );
}
