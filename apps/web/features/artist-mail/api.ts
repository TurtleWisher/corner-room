/* Artist emails (owner, 2026-11-02, D-MAIL-01 and D-MAIL-02). The API decides who may see and send
 * what, works out every audience and writes every email; these are thin calls. People come back as
 * names only (D-BUYERS-01). */

import { apiFetch } from "@/lib/api/client";

const json = { "Content-Type": "application/json" };

export type MailWork = { type: "RELEASE" | "TRACK"; id: string; title?: string };
export type MailWho = "ALL" | "PRESALE";
export type BuyerType = "ANY" | "FIRST_TIME" | "RETURNING";
export type MailPick = { mode: "ALL_BUT" | "ONLY"; refs: string[] };
export type MailAudience = {
  works: MailWork[];
  who: MailWho;
  exclude_works: MailWork[];
  buyer_type: BuyerType;
  bought_from: string | null;
  bought_to: string | null;
  min_owned: number | null;
  pick: MailPick;
};
export type ThankYouAudience = { works: MailWork[]; who: MailWho };
export type MailStatus = "DRAFT" | "IN_REVIEW" | "SCHEDULED" | "SENDING" | "SENT";
export type MailProfile = { kind: "artist" | "band"; id: string };
export type Occasion = "NOTE" | "NEW_RELEASE" | "PRESALE_THANKS" | "MILESTONE" | "BEHIND_THE_SCENES" | "SHOW" | "GIFT";

export const EMPTY_AUDIENCE: MailAudience = {
  works: [],
  who: "ALL",
  exclude_works: [],
  buyer_type: "ANY",
  bought_from: null,
  bought_to: null,
  min_owned: null,
  pick: { mode: "ALL_BUT", refs: [] },
};

/** Fills in what an older saved audience doesn't have. */
export function fullAudience(a: Partial<MailAudience> | null | undefined): MailAudience {
  return {
    ...EMPTY_AUDIENCE,
    ...(a ?? {}),
    works: a?.works ?? [],
    exclude_works: a?.exclude_works ?? [],
    pick: a?.pick ?? { mode: "ALL_BUT", refs: [] },
  };
}

export type MailFile = {
  id: string;
  kind: "FILE" | "LINK";
  name: string;
  url: string | null;
  content_type: string | null;
  byte_size: number | null;
  created_at: string;
};

export type ThankYou = {
  id: string;
  audience: ThankYouAudience;
  subject: string;
  body: string;
  on: boolean;
  file_ids: string[];
  sent_count: number;
  people_clicked: number;
  updated_at: string;
};

export type MailTemplate = {
  id: string;
  name: string;
  subject: string;
  body: string;
  audience: MailAudience;
  occasion: Occasion | null;
  file_ids: string[];
  updated_at: string;
};

export type Reach = { count: number; stopped: number };

export type MailCounts = { PENDING: number; SENT: number; SUPPRESSED: number; FAILED: number };

export type ArtistMail = {
  id: string;
  profile: MailProfile & { display_name: string };
  subject: string;
  body: string;
  audience: MailAudience;
  status: MailStatus;
  review_note?: string | null;
  occasion: Occasion | null;
  file_ids: string[];
  send_at?: string | null;
  /** D-PRESALE-03: a release-day email to pre-order buyers goes out when this release does. */
  send_with_release_id?: string | null;
  sent_at?: string | null;
  created_at: string;
  submitted_at?: string | null;
  approved_at?: string | null;
  recipient_count?: number | null;
  counts: MailCounts;
  reach?: Reach | null;
  files?: { id: string; name: string; kind: string; url: string }[] | null;
};

export type MailOverview = {
  profile: MailProfile & { display_name: string };
  viewer_role: "owner" | "staff";
  thank_yous: ThankYou[];
  templates: MailTemplate[];
  mails: ArtistMail[];
  files: MailFile[];
  stopped_count: number;
  /** Emails the act may send in 7 days; 0 = no limit. */
  weekly_limit: number;
  file_max_bytes: number;
};

/** Names only (D-BUYERS-01): `ref` picks the person and is not their account id. */
export type MailPerson = {
  ref: string;
  name: string;
  has_name: boolean;
  presale: boolean;
  bought: string[];
  picked: boolean;
  stopped: boolean;
};

export type MailChoice = { kind: "artist" | "band"; id: string; display_name: string; receiving: boolean };

/** null when nothing was sent yet: shown as "Not available", never 0 (analytics honesty). */
export type Rate = number | null;

export type MailReport = {
  mail: ArtistMail;
  reached: number | null;
  sent: number;
  waiting: number;
  stopped_before: number;
  failed: number;
  clicks: number;
  people_clicked: number;
  click_rate: Rate;
  downloads: number;
  stops: number;
  stop_rate: Rate;
  links: { position: number; kind: "LINK" | "LISTEN" | "FILE"; label: string; url: string | null; clicks: number; people: number }[];
  timeline: { at: string; sent: number; clicks: number }[];
};

export type ActReport = {
  profile: MailProfile & { display_name: string };
  days: number;
  emails_sent: number;
  thank_yous_sent: number;
  people_clicked: number;
  clicks: number;
  click_rate: Rate;
  failed: number;
  stops: number;
  clicks_by_kind: { LINK: number; LISTEN: number; FILE: number };
  series: { day: string; emails: number; thank_yous: number; clicks: number }[];
  campaigns: {
    id: string;
    subject: string;
    occasion: Occasion | null;
    sent_at: string | null;
    reached: number | null;
    sent: number;
    failed: number;
    people_clicked: number;
    click_rate: Rate;
    stops: number;
  }[];
  thank_yous: { id: string; audience: ThankYouAudience; on: boolean; sent: number; people_clicked: number; click_rate: Rate }[];
};

const works = (list: MailWork[]) => list.map((w) => ({ type: w.type, id: w.id }));
const audienceBody = (a: MailAudience) => ({
  works: works(a.works),
  who: a.who,
  exclude_works: works(a.exclude_works),
  buyer_type: a.buyer_type,
  bought_from: a.bought_from || null,
  bought_to: a.bought_to || null,
  min_owned: a.min_owned || null,
  pick: a.pick,
});
const base = (p: MailProfile) => `/api/v1/studio/profiles/${p.kind}/${p.id}`;
const send = <T>(path: string, method: string, body?: unknown): Promise<T> =>
  apiFetch<T>(path, { method, headers: body === undefined ? undefined : json, body: body === undefined ? undefined : JSON.stringify(body), retry: false });

export function fetchMailOverview(p: MailProfile): Promise<MailOverview> {
  return apiFetch<MailOverview>(`${base(p)}/mail`);
}

// --- thank-you versions ---

type ThankYouInput = { audience: ThankYouAudience; subject: string; body: string; on: boolean; file_ids: string[] };
const thankYouBody = (t: Partial<ThankYouInput>) => ({ ...t, ...(t.audience ? { audience: { works: works(t.audience.works), who: t.audience.who } } : {}) });

/** Goes live at once. */
export function createThankYou(p: MailProfile, t: ThankYouInput): Promise<ThankYou> {
  return send(`${base(p)}/mail/thank-yous`, "POST", thankYouBody(t));
}

export function updateThankYou(id: string, t: Partial<ThankYouInput>): Promise<ThankYou> {
  return send(`/api/v1/studio/mail-thank-yous/${id}`, "PUT", thankYouBody(t));
}

export function deleteThankYou(id: string): Promise<void> {
  return send(`/api/v1/studio/mail-thank-yous/${id}`, "DELETE");
}

// --- people, reach and tests ---

/** The people an audience's filters let through, names only, and how many it reaches. */
export function fetchMailPeople(p: MailProfile, audience: MailAudience): Promise<{ people: MailPerson[]; reach: Reach }> {
  return send(`${base(p)}/mail/people`, "POST", audienceBody(audience));
}

export type TestInput = {
  kind: "THANK_YOU" | "MANUAL";
  subject: string;
  body: string;
  works: MailWork[];
  preview?: { name: string | null; music: string[] } | null;
  file_ids: string[];
};

/** Sends the email as written to your own account address, filled in as the previewed buyer. */
export function sendTestMail(p: MailProfile, t: TestInput): Promise<{ sent_to: string }> {
  return send(`${base(p)}/mail/test`, "POST", { ...t, works: works(t.works) });
}

// --- files ---

/** A soft copy for buyers, kept by Corner Room. */
export function uploadMailFile(p: MailProfile, file: File, name?: string): Promise<MailFile> {
  const form = new FormData();
  form.append("file", file);
  if (name) form.append("name", name);
  return apiFetch<MailFile>(`${base(p)}/mail/files`, { method: "POST", body: form, retry: false, timeoutMs: 120000 });
}

/** A soft copy kept elsewhere (a Drive or Dropbox link). */
export function addMailFileLink(p: MailProfile, name: string, url: string): Promise<MailFile> {
  return send(`${base(p)}/mail/file-links`, "POST", { name, url });
}

export function deleteMailFile(id: string): Promise<void> {
  return send(`/api/v1/studio/mail-files/${id}`, "DELETE");
}

// --- templates ---

type TemplateInput = { name: string; subject: string; body: string; audience: MailAudience; occasion: Occasion | null; file_ids: string[] };

export function createMailTemplate(p: MailProfile, t: TemplateInput): Promise<MailTemplate> {
  return send(`${base(p)}/mail/templates`, "POST", { ...t, audience: audienceBody(t.audience) });
}

export function updateMailTemplate(id: string, t: TemplateInput): Promise<MailTemplate> {
  return send(`/api/v1/studio/mail-templates/${id}`, "PUT", { ...t, audience: audienceBody(t.audience) });
}

export function deleteMailTemplate(id: string): Promise<void> {
  return send(`/api/v1/studio/mail-templates/${id}`, "DELETE");
}

// --- emails to buyers ---

type MailInput = {
  subject: string;
  body: string;
  audience: MailAudience;
  /** ISO time it goes once approved; null = when approved. */
  send_at: string | null;
  occasion: Occasion | null;
  file_ids: string[];
};
const mailBody = (m: MailInput) => ({ ...m, audience: audienceBody(m.audience) });

export function createMail(p: MailProfile, m: MailInput): Promise<ArtistMail> {
  return send(`${base(p)}/mails`, "POST", mailBody(m));
}

export function updateMail(id: string, m: MailInput): Promise<ArtistMail> {
  return send(`/api/v1/studio/mails/${id}`, "PATCH", mailBody(m));
}

export function discardMail(id: string): Promise<void> {
  return send(`/api/v1/studio/mails/${id}`, "DELETE");
}

export function copyMail(id: string): Promise<ArtistMail> {
  return send(`/api/v1/studio/mails/${id}/copy`, "POST");
}

/** Sends it to Corner Room for review; it goes out once approved, or at its time. */
export function submitMail(id: string): Promise<ArtistMail> {
  return send(`/api/v1/studio/mails/${id}/submit`, "POST");
}

export function withdrawMail(id: string): Promise<ArtistMail> {
  return send(`/api/v1/studio/mails/${id}/withdraw`, "POST");
}

// --- reports ---

export function fetchMailReport(id: string): Promise<MailReport> {
  return apiFetch<MailReport>(`/api/v1/studio/mails/${id}/report`);
}

export function fetchActMailReport(p: MailProfile, days: 30 | 90 | 365): Promise<ActReport> {
  return apiFetch<ActReport>(`${base(p)}/mail/report?days=${days}`);
}

// --- staff ---

/** Staff: artists' emails waiting in the active workspace. */
export function fetchMailReviewQueue(): Promise<ArtistMail[]> {
  return apiFetch<ArtistMail[]>("/api/v1/catalog-intake/artist-mails");
}

export function reviewMail(id: string, action: "approve" | "reject", note?: string): Promise<ArtistMail> {
  return send(`/api/v1/catalog-intake/artist-mails/${id}/review`, "POST", { action, note: note || null });
}

// --- buyers ---

/** Artists and bands you bought from, and whether you get their emails. */
export function fetchMyMailChoices(): Promise<MailChoice[]> {
  return apiFetch<MailChoice[]>("/api/v1/me/artist-mail");
}

export function setMyMailChoice(kind: "artist" | "band", id: string, receiving: boolean): Promise<MailChoice[]> {
  return send(`/api/v1/me/artist-mail/${kind}/${id}`, "PUT", { receiving });
}

/** The stop link in an email to buyers: no sign-in. */
export function fetchStopLink(token: string): Promise<{ artist: string; stopped: boolean }> {
  return apiFetch<{ artist: string; stopped: boolean }>(`/api/v1/artist-mail/stop/${encodeURIComponent(token)}`, { skipAuth: true, skipRefresh: true, retry: false });
}

export function stopEmailsByLink(token: string): Promise<{ artist: string; stopped: boolean }> {
  return apiFetch<{ artist: string; stopped: boolean }>(`/api/v1/artist-mail/stop/${encodeURIComponent(token)}`, {
    method: "POST",
    skipAuth: true,
    skipRefresh: true,
    retry: false,
  });
}
