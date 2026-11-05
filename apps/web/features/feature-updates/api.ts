/* Corner Room's feature updates log (owner, 2026-11-06, D-UPDATES-01). Staff only: the API answers
 * 404 to anyone else, so the list never ships in the public site. */

import { apiFetch } from "@/lib/api/client";

export type UpdateKind = "NEW" | "IMPROVED" | "FIXED";
export type FeatureUpdate = { date: string; kind: UpdateKind; title: string; details: string };
export type Feature = {
  id: string;
  name: string;
  area: string;
  audience: string[];
  summary: string;
  description: string;
  first_date: string;
  last_date: string;
  updates: FeatureUpdate[];
};

export function fetchFeatureUpdates(): Promise<Feature[]> {
  return apiFetch<Feature[]>("/api/v1/staff/feature-updates");
}
