"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useEffect, useState } from "react";
import { Search as SearchIcon } from "lucide-react";

import { useAuth } from "@/components/auth-provider";
import { LitSurface } from "@/components/brand/corner-light";
import { CoverArt } from "@/components/brand/cover-art";
import { RoomCube } from "@/components/brand/room-cube";
import { Avatar, Button, EmptyState, ErrorState, Input, Skeleton } from "@/components/ds";
import { EventMedia } from "@/components/events/event-media";
import { PageIntro, RetryButton } from "@/components/shell/staff-panel";
import { loadErrorMessage, useAsync } from "@/components/use-async";
import { useWorkspace } from "@/components/workspace-provider";
import { fetchSearch, type SearchHitRecord } from "@/lib/api";
import { coverUrl } from "@/lib/cover-view";
import { humanizeStatus } from "@/lib/format/status";
import { allowedSearchEntityTypes, buildSearchHref, isGuestLikeSearch, sanitizeSearchEntityType, searchResultHref } from "@/lib/search-view";
import { cn } from "@/lib/utils";

const TYPE_LABEL: Record<string, string> = { EVENT: "Events", ARTIST: "Artists", BAND: "Bands", RELEASE: "Releases", TRACK: "Tracks", VENUE: "Venues", CAMPAIGN: "Campaigns", USER: "Users", ORGANIZATION: "Organizations" };

function Thumb({ hit }: { hit: SearchHitRecord }) {
  if (hit.entity_type === "EVENT") return <EventMedia title={hit.title} eventId={hit.entity_id} size="front" />;
  if (hit.entity_type === "RELEASE" || hit.entity_type === "TRACK") {
    return (
      <div className="aspect-square w-full bg-cr-sky">
        <CoverArt
          src={coverUrl(hit.entity_type === "RELEASE" ? { release: hit.entity_id } : { track: hit.entity_id }, 160)}
          fallback={<RoomCube front={hit.title} side={hit.subtitle || hit.title} tone="sky" size="front" label="" className="size-full" />}
          className="size-full"
        />
      </div>
    );
  }
  return <Avatar name={hit.title} size={56} />;
}

function Results({ q, type }: { q: string; type: string | null }) {
  const [extra, setExtra] = useState<{ items: SearchHitRecord[]; cursor: string | null }>({ items: [], cursor: null });
  const first = useAsync(() => (q.trim() ? fetchSearch({ q, entity_type: type }) : Promise.resolve({ items: [], next_cursor: null })), [q, type]);
  useEffect(() => setExtra({ items: [], cursor: null }), [q, type]);

  if (!q.trim()) return <p className="text-fg-muted">Search for events, artists, bands, releases and tracks.</p>;
  if (first.status === "loading") return <Skeleton className="h-48 w-full" />;
  if (first.status === "error") return <ErrorState title="Search unavailable" message={loadErrorMessage(first.error, "search results")} action={<RetryButton onClick={first.reload} />} />;
  const items = [...first.data.items, ...extra.items];
  const cursor = extra.cursor ?? (extra.items.length ? null : first.data.next_cursor);
  if (items.length === 0) return <EmptyState title={`Nothing found for "${q}"`} body="Try a shorter word, or a different spelling." />;

  // Group in the API's order (relevance), by type, with the type as a micro-label (account.md).
  const groups: { type: string; hits: SearchHitRecord[] }[] = [];
  for (const hit of items) {
    const g = groups.find((x) => x.type === hit.entity_type);
    if (g) g.hits.push(hit);
    else groups.push({ type: hit.entity_type, hits: [hit] });
  }
  return (
    <div className="space-y-10">
      {groups.map((g) => (
        <section key={g.type} aria-labelledby={`g-${g.type}`}>
          <h2 id={`g-${g.type}`} className="cr-eyebrow border-b border-line pb-3 text-[0.75rem] text-highlight">
            {TYPE_LABEL[g.type] ?? humanizeStatus(g.type)}
          </h2>
          <ul>
            {g.hits.map((hit) => {
              const href = searchResultHref(hit.route, hit);
              return (
                <li key={`${hit.entity_type}-${hit.entity_id}`} className="grid grid-cols-[3.5rem_minmax(0,1fr)] items-center gap-4 border-b border-line py-4">
                  <div className="w-14">
                    <Thumb hit={hit} />
                  </div>
                  <div className="min-w-0">
                    {href ? (
                      <Link href={href} className="cr-focus block truncate text-lg font-bold text-fg hover:text-highlight">
                        {hit.title}
                      </Link>
                    ) : (
                      <p className="truncate text-lg font-bold text-fg">{hit.title}</p>
                    )}
                    {hit.subtitle ? <p className="truncate text-sm text-fg-muted">{hit.subtitle}</p> : null}
                    {hit.snippet && hit.snippet !== hit.title ? <p className="mt-1 line-clamp-2 text-sm text-fg">{hit.snippet}</p> : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {cursor ? (
        <Button
          variant="secondary"
          onClick={() => void fetchSearch({ q, entity_type: type, cursor }).then((p) => setExtra((e) => ({ items: [...e.items, ...p.items], cursor: p.next_cursor })))}
        >
          Show more
        </Button>
      ) : null}
    </div>
  );
}

function SearchBody() {
  const router = useRouter();
  const params = useSearchParams();
  const { status } = useAuth();
  const { currentOrg } = useWorkspace();
  const guestLike = isGuestLikeSearch(status === "authenticated", currentOrg?.id ?? null);
  const q = params.get("q") ?? "";
  const type = sanitizeSearchEntityType(params.get("entity_type"), guestLike);
  const [draft, setDraft] = useState(q);
  useEffect(() => setDraft(q), [q]);

  function submit(e: FormEvent) {
    e.preventDefault();
    router.push(buildSearchHref(draft.trim(), type, null));
  }

  return (
    <>
      <form role="search" onSubmit={submit} className="flex max-w-2xl gap-2">
        <label htmlFor="search-q" className="sr-only">
          Search Corner Room
        </label>
        <Input id="search-q" type="search" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Events, artists, releases, tracks" autoFocus className="h-12 text-base" />
        <Button type="submit" size="lg" aria-label="Search">
          <SearchIcon aria-hidden="true" />
        </Button>
      </form>
      <nav aria-label="Filter results" className="mt-5 flex flex-wrap gap-2">
        {[null, ...allowedSearchEntityTypes(guestLike)].map((t) => (
          <Link
            key={t ?? "all"}
            href={buildSearchHref(q, t, null)}
            aria-current={t === type ? "page" : undefined}
            className={cn("cr-focus border px-3 py-1.5 text-sm font-semibold", t === type ? "border-highlight text-fg" : "border-line text-fg-muted hover:text-fg")}
          >
            {t ? (TYPE_LABEL[t] ?? humanizeStatus(t)) : "All"}
          </Link>
        ))}
      </nav>
      <div className="mt-10">
        <Results q={q} type={type} />
      </div>
    </>
  );
}

export default function SearchPage() {
  return (
    <main id="main" data-theme="ember" data-module="account" className="cr-scope">
      <LitSurface as="section" theme="ember" aria-labelledby="search-title">
        <div className="mx-auto max-w-[90rem] px-4 pb-8 pt-12 md:px-6 md:pt-16">
          <div id="search-title">
            <PageIntro eyebrow="Search" title="Find it" />
          </div>
        </div>
      </LitSurface>
      <div className="mx-auto max-w-[90rem] px-4 pb-16 md:px-6">
        <Suspense fallback={<Skeleton className="h-12 w-full max-w-2xl" />}>
          <SearchBody />
        </Suspense>
      </div>
    </main>
  );
}
