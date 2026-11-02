/* Artist emails (owner, 2026-11-02, D-MAIL-01). The API decides who may see and send what and
 * works out every audience; these are thin calls. Buyers come back as names only (D-BUYERS-01). */

import { apiFetch } from "@/lib/api/client";

const json = { "Content-Type": "application/json" };

export type MailWork = { type: "RELEASE" | "TRACK"; id: string; title?: string };
export type MailWho = "ALL" | "PRESALE" | "PICKED";
export type MailAudience = { works: MailWork[]; who: MailWho; picked: string[] };
export type MailStatus = "DRAFT" | "IN_REVIEW" | "SENDING" | "SENT";
export type MailProfile = { kind: "artist" | "band"; id: string };

export type ThankYou = {
  on: boolean;
  subject: string;
  body: string;
  default_subject: string;
  default_body: string;
  sent_count: number;
};

export type MailTemplate = { id: string; name: string; subject: string; body: string; audience: MailAudience; updated_at: string };

export type Reach = { count: number; stopped: number };

export type ArtistMail = {
  id: string;
  profile: MailProfile & { display_name: string };
  subject: string;
  body: string;
  audience: MailAudience;
  status: MailStatus;
  review_note?: string | null;
  created_at: string;
  submitted_at?: string | null;
  approved_at?: string | null;
  recipient_count?: number | null;
  /** PENDING, SENT and SUPPRESSED (stopped the act's emails before it went). */
  counts: { PENDING: number; SENT: number; SUPPRESSED: number };
  reach?: Reach | null;
};

export type MailOverview = {
  profile: MailProfile & { display_name: string };
  viewer_role: "owner" | "staff";
  thank_you: ThankYou;
  templates: MailTemplate[];
  mails: ArtistMail[];
  stopped_count: number;
  /** Emails the act may send in 7 days; 0 = no limit. */
  weekly_limit: number;
};

export type MailBuyer = { ref: string; name: string; presale: boolean };
export type MailChoice = { kind: "artist" | "band"; id: string; display_name: string; receiving: boolean };

type AudienceInput = { works: MailWork[]; who: MailWho; picked: string[] };
const audienceBody = (a: AudienceInput) => ({ works: a.works.map((w) => ({ type: w.type, id: w.id })), who: a.who, picked: a.who === "PICKED" ? a.picked : [] });
const base = (p: MailProfile) => `/api/v1/studio/profiles/${p.kind}/${p.id}`;

export function fetchMailOverview(p: MailProfile): Promise<MailOverview> {
  return apiFetch<MailOverview>(`${base(p)}/mail`);
}

/** Goes live at once. Empty text goes back to Corner Room's default. */
export function saveThankYou(p: MailProfile, body: { on?: boolean; subject?: string; body?: string }): Promise<ThankYou> {
  return apiFetch<ThankYou>(`${base(p)}/mail/thank-you`, { method: "PUT", headers: json, body: JSON.stringify(body), retry: false });
}

/** Sends the email as written to your own account address. */
export function sendTestMail(p: MailProfile, body: { kind: "THANK_YOU" | "MANUAL"; subject: string; body: string }): Promise<{ sent_to: string }> {
  return apiFetch<{ sent_to: string }>(`${base(p)}/mail/test`, { method: "POST", headers: json, body: JSON.stringify(body), retry: false });
}

export function fetchMailBuyers(p: MailProfile, works: MailWork[]): Promise<MailBuyer[]> {
  const q = works.map((w) => `work=${w.type}:${w.id}`).join("&");
  return apiFetch<MailBuyer[]>(`${base(p)}/mail/buyers?${q}`, { retry: false });
}

export function fetchReach(p: MailProfile, audience: AudienceInput): Promise<Reach> {
  return apiFetch<Reach>(`${base(p)}/mail/reach`, { method: "POST", headers: json, body: JSON.stringify(audienceBody(audience)), retry: false });
}

type TemplateInput = { name: string; subject: string; body: string; audience: AudienceInput };

export function createMailTemplate(p: MailProfile, t: TemplateInput): Promise<MailTemplate> {
  return apiFetch<MailTemplate>(`${base(p)}/mail/templates`, {
    method: "POST",
    headers: json,
    body: JSON.stringify({ ...t, audience: audienceBody(t.audience) }),
    retry: false,
  });
}

export function updateMailTemplate(id: string, t: TemplateInput): Promise<MailTemplate> {
  return apiFetch<MailTemplate>(`/api/v1/studio/mail-templates/${id}`, {
    method: "PUT",
    headers: json,
    body: JSON.stringify({ ...t, audience: audienceBody(t.audience) }),
    retry: false,
  });
}

export function deleteMailTemplate(id: string): Promise<void> {
  return apiFetch<void>(`/api/v1/studio/mail-templates/${id}`, { method: "DELETE", retry: false });
}

type MailInput = { subject: string; body: string; audience: AudienceInput };

export function createMail(p: MailProfile, m: MailInput): Promise<ArtistMail> {
  return apiFetch<ArtistMail>(`${base(p)}/mails`, {
    method: "POST",
    headers: json,
    body: JSON.stringify({ ...m, audience: audienceBody(m.audience) }),
    retry: false,
  });
}

export function updateMail(id: string, m: MailInput): Promise<ArtistMail> {
  return apiFetch<ArtistMail>(`/api/v1/studio/mails/${id}`, {
    method: "PATCH",
    headers: json,
    body: JSON.stringify({ ...m, audience: audienceBody(m.audience) }),
    retry: false,
  });
}

export function discardMail(id: string): Promise<void> {
  return apiFetch<void>(`/api/v1/studio/mails/${id}`, { method: "DELETE", retry: false });
}

/** Sends it to Corner Room for review; it goes out once approved. */
export function submitMail(id: string): Promise<ArtistMail> {
  return apiFetch<ArtistMail>(`/api/v1/studio/mails/${id}/submit`, { method: "POST", retry: false });
}

export function withdrawMail(id: string): Promise<ArtistMail> {
  return apiFetch<ArtistMail>(`/api/v1/studio/mails/${id}/withdraw`, { method: "POST", retry: false });
}

/** Staff: artists' emails waiting in the active workspace. */
export function fetchMailReviewQueue(): Promise<ArtistMail[]> {
  return apiFetch<ArtistMail[]>("/api/v1/catalog-intake/artist-mails");
}

export function reviewMail(id: string, action: "approve" | "reject", note?: string): Promise<ArtistMail> {
  return apiFetch<ArtistMail>(`/api/v1/catalog-intake/artist-mails/${id}/review`, {
    method: "POST",
    headers: json,
    body: JSON.stringify({ action, note: note || null }),
    retry: false,
  });
}

/** Artists and bands you bought from, and whether you get their emails. */
export function fetchMyMailChoices(): Promise<MailChoice[]> {
  return apiFetch<MailChoice[]>("/api/v1/me/artist-mail");
}

export function setMyMailChoice(kind: "artist" | "band", id: string, receiving: boolean): Promise<MailChoice[]> {
  return apiFetch<MailChoice[]>(`/api/v1/me/artist-mail/${kind}/${id}`, { method: "PUT", headers: json, body: JSON.stringify({ receiving }), retry: false });
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
