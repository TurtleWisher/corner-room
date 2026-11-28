/* Corner Room Wrap (owner, 2026-11-28, D-WRAP-01). The API builds every number from what the person
 * really did and decides who may see what; the web app only tells the story and draws the share
 * picture. Platform staff run each Wrap from the staff console. */

import { apiFetch } from "@/lib/api/client";

export type WrapLook = "MARQUEE" | "CAROUSEL" | "FAIRGROUND";
export type WrapMotion = "LIVELY" | "CALM" | "STILL";
export type WrapDitherStyle = "BAYER" | "GRAIN";
export type WrapCardKey =
  | "INTRO"
  | "MINUTES"
  | "TOP_SONG"
  | "TOP_SONGS"
  | "TOP_ACTS"
  | "FAN_RANK"
  | "CLOCK"
  | "MONTHS"
  | "STREAK"
  | "DISCOVERY"
  | "COLLECTION"
  | "EVENTS"
  | "GIFTS"
  | "SUMMARY";
export type WrapStatus = "DRAFT" | "LIVE" | "ENDED";
export type WrapFanState = "OPEN" | "SOON" | "CLOSED";
export type WrapDayPart = "EARLY_BIRD" | "DAYTIME" | "SUNDOWN" | "NIGHT_OWL";

export type WrapDither = { style: WrapDitherStyle; cell: number; motion: WrapMotion };
export type WrapSharing = { on: boolean; show_name: boolean; show_link: boolean };

export type WrapSeasonView = {
  id: string;
  name: string;
  starts_on: string;
  ends_on: string;
  year: number;
  opens_at: string | null;
  closes_at: string | null;
  fan_state: WrapFanState;
  tagline: string;
  intro: string | null;
  outro: string | null;
  look: WrapLook;
  dither: WrapDither;
  slide_seconds: number;
  sharing: WrapSharing;
  /** Listed only because the viewer is staff (a draft, or not open yet). */
  staff_only?: boolean;
};

export type WrapSong = { track_id: string; title: string | null; act_id: string | null; act: string | null; listens: number; minutes: number };
export type WrapAct = { act_id: string; name: string | null; kind: "SOLO" | "BAND" | null; picture: string | null; listens: number; songs: number };
export type WrapEvent = { event_id: string; title: string; starts_at: string; has_poster: boolean; tickets: number; attended: boolean };

export type WrapStats = {
  period: { starts_on: string; ends_on: string };
  listens: number;
  minutes: number;
  songs: number;
  acts: number;
  top_songs: WrapSong[];
  top_acts: WrapAct[];
  fan_rank: { act_id: string; act: string | null; rank: number; listeners: number; top_percent: number } | null;
  hours: number[];
  peak_hour: number | null;
  day_part: WrapDayPart | null;
  months: { month: string; listens: number }[];
  streak: { days: number; from: string; to: string } | null;
  busiest_day: { day: string; listens: number } | null;
  first_song: { track_id: string; day: string; title: string | null; act: string | null } | null;
  new_songs: number;
  new_acts: number;
  new_act_names: string[];
  bought: { songs: number; releases: number; preorders: number; first: { kind: "TRACK" | "RELEASE"; id: string; day: string; title: string | null } | null };
  events: { tickets: number; events: number; attended: number; list: WrapEvent[] };
  gifts: { given: number; received: number };
  follows: number;
};

export type WrapCard = { key: WrapCardKey; title: string | null };

export type MyWrap = {
  season: WrapSeasonView;
  /** Staff looking at it before fans can (built from their own listening, never kept). */
  preview: boolean;
  person: { name: string | null; first_name: string | null };
  enough: boolean;
  min_listens: number;
  cards: WrapCard[];
  stats: WrapStats;
};

export type WrapCountKind = "FINISHED" | "SHARED_SHEET" | "SHARED_SAVE" | "SHARED_LINK" | "PLAYED";

export async function fetchWraps(): Promise<WrapSeasonView[]> {
  const page = await apiFetch<{ items: WrapSeasonView[] }>("/api/v1/wraps", { retry: false });
  return page.items;
}

export function fetchMyWrap(id: string, preview = false): Promise<MyWrap> {
  return apiFetch<MyWrap>(`/api/v1/wraps/${encodeURIComponent(id)}${preview ? "?preview=true" : ""}`);
}

const json = { "Content-Type": "application/json" };

/** Counts only. Never throws: a count that doesn't land changes nothing for the person. */
export async function countWrap(id: string, kind: WrapCountKind): Promise<void> {
  try {
    await apiFetch<void>(`/api/v1/wraps/${encodeURIComponent(id)}/count`, { method: "POST", headers: json, body: JSON.stringify({ kind }), retry: false });
  } catch {
    /* counting is best effort */
  }
}

// --- staff -------------------------------------------------------------------------------------------

export type WrapCardSetting = { key: WrapCardKey; on: boolean; title: string | null };
export type WrapSettings = {
  tagline: string;
  intro: string | null;
  outro: string | null;
  look: WrapLook;
  dither: WrapDither;
  slide_seconds: number;
  cards: WrapCardSetting[];
  rules: { min_listens: number; top_count: number; fan_rank_min_listeners: number };
  sharing: WrapSharing;
};

export type WrapNumbers = {
  built: number;
  opened: number;
  finished: number;
  shared_sheet: number;
  shared_save: number;
  shared_link: number;
  played: number;
};

export type StaffWrap = WrapSeasonView & {
  status: WrapStatus;
  version: number;
  settings: WrapSettings;
  transitions: WrapStatus[];
  went_live_at: string | null;
  ended_at: string | null;
  updated_at: string;
  numbers: WrapNumbers;
  days?: ({ day: string } & Omit<WrapNumbers, "built">)[];
  people_with_listens?: number;
  cleared?: number;
};

export type WrapOptions = {
  cards: WrapCardKey[];
  looks: WrapLook[];
  motions: WrapMotion[];
  dithers: WrapDitherStyle[];
  fill_ins: string[];
  limits: { top: [number, number]; cell: [number, number]; slide_seconds: [number, number]; period_days: number; title: number; words: number };
};

export function fetchStaffWraps(): Promise<{ items: StaffWrap[]; options: WrapOptions }> {
  return apiFetch("/api/v1/staff/wraps");
}

export function fetchStaffWrap(id: string): Promise<StaffWrap> {
  return apiFetch(`/api/v1/staff/wraps/${encodeURIComponent(id)}`);
}

export function createWrap(body: { name: string; starts_on: string; ends_on: string }): Promise<StaffWrap> {
  return apiFetch("/api/v1/staff/wraps", { method: "POST", headers: json, body: JSON.stringify(body) });
}

export type WrapUpdate = {
  version: number;
  name?: string;
  starts_on?: string;
  ends_on?: string;
  window?: { opens_at: string | null; closes_at: string | null };
  settings?: WrapSettings;
};

export function updateWrap(id: string, body: WrapUpdate): Promise<StaffWrap> {
  return apiFetch(`/api/v1/staff/wraps/${encodeURIComponent(id)}`, { method: "PUT", headers: json, body: JSON.stringify(body) });
}

export function transitionWrap(id: string, to: WrapStatus): Promise<StaffWrap> {
  return apiFetch(`/api/v1/staff/wraps/${encodeURIComponent(id)}/transition`, { method: "POST", headers: json, body: JSON.stringify({ to }) });
}

export function rebuildWrap(id: string): Promise<StaffWrap> {
  return apiFetch(`/api/v1/staff/wraps/${encodeURIComponent(id)}/rebuild`, { method: "POST" });
}

export function deleteWrap(id: string): Promise<void> {
  return apiFetch(`/api/v1/staff/wraps/${encodeURIComponent(id)}`, { method: "DELETE" });
}
