"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import { useAuth } from "@/components/auth-provider";
import { useWorkspace } from "@/components/workspace-provider";
import { EmptyState, ErrorState, LoadingState } from "@/components/async-state";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ApiError, fetchSearch, type SearchHitRecord } from "@/lib/api";
import {
  SEARCH_DEBOUNCE_MS,
  SEARCH_NO_QUERY,
  SEARCH_NO_RESULTS,
  allowedSearchEntityTypes,
  buildSearchHref,
  isGuestLikeSearch,
  keepApiSearchOrder,
  sanitizeSearchEntityType,
  searchEmptyKind,
  searchResultHref,
} from "@/lib/search-view";

function SearchBody() {
  const router = useRouter();
  const params = useSearchParams();
  const { status } = useAuth();
  const { currentOrg } = useWorkspace();
  const authenticated = status === "authenticated";
  const guestLike = isGuestLikeSearch(authenticated, currentOrg?.id ?? null);
  const urlQuery = params.get("q") ?? "";
  const rawType = params.get("entity_type");
  const urlType = sanitizeSearchEntityType(rawType, guestLike);
  const urlCursor = params.get("cursor");
  const [draft, setDraft] = useState(urlQuery);
  const [items, setItems] = useState<SearchHitRecord[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(urlQuery);
  }, [urlQuery]);

  useEffect(() => {
    if (status === "loading") {
      return;
    }
    if (rawType && sanitizeSearchEntityType(rawType, guestLike) === null) {
      router.replace(buildSearchHref(urlQuery, null, urlCursor));
    }
  }, [status, guestLike, rawType, urlQuery, urlCursor, router]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      if (draft === urlQuery) {
        return;
      }
      router.replace(buildSearchHref(draft, urlType, null));
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [draft, urlQuery, urlType, router]);

  useEffect(() => {
    let cancelled = false;
    if (status === "loading") {
      return () => {
        cancelled = true;
      };
    }
    const entityType = sanitizeSearchEntityType(urlType, guestLike);
    if (!urlQuery.trim()) {
      setItems([]);
      setNextCursor(null);
      setError(null);
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }
    setLoading(true);
    setError(null);
    void fetchSearch({
      q: urlQuery,
      entity_type: entityType,
      cursor: urlCursor,
      skipAuth: !authenticated,
    })
      .then((page) => {
        if (cancelled) {
          return;
        }
        setItems(keepApiSearchOrder(page.items));
        setNextCursor(page.next_cursor);
      })
      .catch((err: unknown) => {
        if (cancelled) {
          return;
        }
        setItems([]);
        setNextCursor(null);
        setError(err instanceof ApiError ? err.message : "Unable to search");
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [status, urlQuery, urlType, urlCursor, guestLike, authenticated, currentOrg?.id]);

  const kind = searchEmptyKind(urlQuery, Boolean(error), items.length);
  const types = allowedSearchEntityTypes(guestLike);

  function setType(next: string) {
    router.replace(buildSearchHref(draft || urlQuery, next || null, null));
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Search</h1>
        <p className="text-sm text-neutral-600">
          Results are returned by the API. This page does not rank or invent missing entities.
        </p>
      </div>
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          router.replace(buildSearchHref(draft, urlType, null));
        }}
      >
        <label className="block text-sm">
          <span className="mb-1 block text-neutral-600">Query</span>
          <Input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Search artists, events, tracks"
            aria-label="Search query"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-neutral-600">Entity type</span>
          <select
            className="flex h-10 w-full rounded-md border border-neutral-300 bg-white px-3 text-sm focus-visible:outline-none focus-visible:ring-2"
            value={urlType ?? ""}
            onChange={(event) => setType(event.target.value)}
            aria-label="Entity type"
          >
            <option value="">All allowed types</option>
            {types.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit">Search</Button>
      </form>
      {error ? <ErrorState message={error} /> : null}
      {loading ? <LoadingState label="Searching" /> : null}
      {kind === "prompt" ? <EmptyState message={SEARCH_NO_QUERY} /> : null}
      {kind === "empty" && !loading ? <EmptyState message={SEARCH_NO_RESULTS} /> : null}
      <section className="space-y-3" aria-label="Search results">
        {items.map((hit) => {
          const href = searchResultHref(hit.route);
          return (
            <Card key={`${hit.entity_type}-${hit.entity_id}`}>
              <p className="text-xs uppercase tracking-wide text-neutral-500">{hit.entity_type}</p>
              <p className="font-medium">
                {href ? (
                  <Link href={href} className="underline">
                    {hit.title}
                  </Link>
                ) : (
                  hit.title
                )}
              </p>
              {hit.subtitle ? <p className="text-sm text-neutral-600">{hit.subtitle}</p> : null}
              {hit.snippet ? <p className="text-sm text-neutral-600">{hit.snippet}</p> : null}
              {hit.organization_id ? (
                <p className="text-xs text-neutral-500">Organization {hit.organization_id}</p>
              ) : null}
            </Card>
          );
        })}
      </section>
      {nextCursor ? (
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push(buildSearchHref(urlQuery, urlType, nextCursor))}
        >
          Next
        </Button>
      ) : null}
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={<LoadingState label="Loading search" />}>
      <SearchBody />
    </Suspense>
  );
}
