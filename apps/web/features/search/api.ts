/* Search. Split from lib/api.ts (Phase 16, Stage 5). */

import { type Page } from "@/features/identity/api";
import { apiFetch } from "@/lib/api/client";

export type SearchHitRecord = {
  entity_type: string;
  entity_id: string;
  title: string;
  subtitle: string | null;
  snippet: string;
  organization_id: string | null;
  visibility: string;
  route: string | null;
};

export async function fetchSearch(params: {
  q: string;
  entity_type?: string | null;
  cursor?: string | null;
  skipAuth?: boolean;
}): Promise<Page<SearchHitRecord>> {
  const search = new URLSearchParams();
  search.set("q", params.q);
  if (params.entity_type) {
    search.set("entity_type", params.entity_type);
  }
  if (params.cursor) {
    search.set("cursor", params.cursor);
  }
  return apiFetch<Page<SearchHitRecord>>(`/api/v1/search?${search.toString()}`, {
    retry: false,
    skipAuth: params.skipAuth,
    skipRefresh: params.skipAuth,
  });
}
