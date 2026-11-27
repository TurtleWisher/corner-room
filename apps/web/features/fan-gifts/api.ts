/*
 * Fan gifts and gift credit (owner, 2026-11-20, D-GIFT-FAN-01). Buying a gift and paying with
 * credit go through POST /orders (`gift`, `use_credit`); the server decides every total.
 */

import { apiFetch, getAccessToken, getApiBaseUrl } from "@/lib/api/client";
import type { OrderRecord } from "@/features/ticketing/api";

export type MoneyValue = { amount_minor: number; currency_code: string };

export type GiftPerson = { email: string; name?: string | null };

export type GiftStatus = "WAITING" | "GIVEN" | "WAITING_ACCOUNT" | "CHOOSING" | "KEPT_CREDIT" | "PASSED_ON" | "DECLINED" | "EXPIRED";

export type GiftChoice = "KEEP_CREDIT" | "PASS_ON" | "DECLINE";

/** D-GIFT-FAN-02: a picture (shown in the email) or a PDF (a download). */
export type GiftFile = { id: string; name: string; kind: "IMAGE" | "PDF"; byte_size: number };

export type GiftLook = "SKY" | "EMBER" | "NIGHT";

/** The giver's own email: message (fill-ins and links), subject, look, cover switch and files. */
export type GiftDesign = { note: string; subject: string; look: GiftLook; show_cover: boolean; file_ids: string[] };

export type GiftPreview = { subject: string; html: string; text: string; needs_review: boolean };

export type SpendOption = {
  offer_id: string;
  kind: "TRACK" | "RELEASE";
  subject_id: string;
  title: string;
  price: MoneyValue;
  open_price: boolean;
};

export type GiftPage = {
  giver_name: string | null;
  passed_on_by: string | null;
  work_type: "TRACK" | "RELEASE";
  work_id: string;
  title: string;
  act_name: string;
  note: string | null;
  /** A pre-order gift: it unlocks on release day. */
  preorder?: boolean;
  for_email: string;
  viewer: "RECIPIENT" | "SIGNED_IN" | "SIGNED_OUT";
  status: GiftStatus | null;
  expires_at: string | null;
  amount: MoneyValue | null;
  credit: MoneyValue | null;
  spend_on: SpendOption[];
  /** The giver's pictures and PDFs, once Corner Room passed them. */
  files?: GiftFile[];
};

export type GiverState = "NOT_SENT_YET" | "DELIVERED" | "ACCEPTED" | "PASSED_ON" | "DECLINED" | "NOT_CLAIMED";

export type MyGift = {
  id: string;
  order_id: string;
  work_type: "TRACK" | "RELEASE";
  work_id: string;
  title: string;
  act_name: string;
  status: "PENDING_PAYMENT" | "WAITING_NOTE" | "DELIVERED" | "CANCELLED";
  note_state: "NONE" | "WAITING" | "APPROVED" | "REMOVED";
  created_at: string | null;
  each: MoneyValue;
  /** Someone didn't claim it: send it again, with credit (D-GIFT-FAN-03). */
  send_again_offer_id?: string | null;
  people: { email: string; name: string | null; state: GiverState }[];
};

export type GiftCredit = { act_id: string; act_name: string; balance: MoneyValue };

export type OfferCredit = { usable: boolean; balance: MoneyValue | null; act_name: string | null };

export type FanGiftNote = {
  id: string;
  note: string | null;
  subject?: string | null;
  look?: GiftLook;
  files?: GiftFile[];
  title: string;
  act_name: string;
  giver_name: string | null;
  people: number;
  paid_at: string | null;
};

export async function createGiftOrder(
  offerId: string,
  idempotencyKey: string,
  gift: { people: GiftPerson[]; note: string | null; subject?: string | null; look?: GiftLook; show_cover?: boolean; file_ids?: string[] },
  amountMinor?: number,
  /** Pay for the gift with the giver's gift credit for this act (owner, 2026-11-27, D-GIFT-FAN-03). */
  useCredit = false,
): Promise<OrderRecord> {
  return apiFetch<OrderRecord>("/api/v1/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({
      offer_id: offerId,
      gift,
      ...(useCredit ? { use_credit: true } : {}),
      ...(amountMinor === undefined ? {} : { amount_minor: amountMinor }),
    }),
    retry: false,
  });
}

export async function createCreditOrder(offerId: string, idempotencyKey: string, deliveryConfirmed: boolean, amountMinor?: number): Promise<OrderRecord> {
  return apiFetch<OrderRecord>("/api/v1/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({
      offer_id: offerId,
      use_credit: true,
      delivery_address_confirmed: deliveryConfirmed,
      ...(amountMinor === undefined ? {} : { amount_minor: amountMinor }),
    }),
    retry: false,
  });
}

export async function openGift(token: string): Promise<GiftPage> {
  return apiFetch<GiftPage>(`/api/v1/gifts/${encodeURIComponent(token)}`);
}

export async function chooseGift(token: string, choice: GiftChoice, person?: GiftPerson): Promise<GiftPage> {
  return apiFetch<GiftPage>(`/api/v1/gifts/${encodeURIComponent(token)}/choose`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ choice, email: person?.email ?? null, name: person?.name ?? null }),
    retry: false,
  });
}

export async function fetchMyFanGifts(): Promise<MyGift[]> {
  return apiFetch<MyGift[]>("/api/v1/me/fan-gifts");
}

export async function fetchMyGiftCredit(): Promise<GiftCredit[]> {
  return apiFetch<GiftCredit[]>("/api/v1/me/gift-credit");
}

export async function fetchOfferCredit(offerId: string): Promise<OfferCredit> {
  return apiFetch<OfferCredit>(`/api/v1/me/gift-credit/offers/${offerId}`);
}

export async function uploadGiftFile(file: File): Promise<GiftFile> {
  const form = new FormData();
  form.append("file", file);
  return apiFetch<GiftFile>("/api/v1/me/fan-gift-files", { method: "POST", body: form, retry: false, timeoutMs: 120000 });
}

export async function deleteGiftFile(id: string): Promise<void> {
  await apiFetch<void>(`/api/v1/me/fan-gift-files/${id}`, { method: "DELETE", retry: false });
}

/** The gift email exactly as one person will get it; nothing is sent or kept. */
export async function previewGiftEmail(offerId: string, design: GiftDesign, personName: string | null, amountMinor?: number): Promise<GiftPreview> {
  return apiFetch<GiftPreview>("/api/v1/fan-gifts/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      offer_id: offerId,
      note: design.note || null,
      subject: design.subject || null,
      look: design.look,
      show_cover: design.show_cover,
      file_ids: design.file_ids,
      person_name: personName,
      ...(amountMinor === undefined ? {} : { amount_minor: amountMinor }),
    }),
    retry: false,
  });
}

export async function fetchStaffGiftPreview(giftId: string): Promise<{ subject: string; html: string; files: GiftFile[] }> {
  return apiFetch(`/api/v1/staff/fan-gift-notes/${giftId}/preview`);
}

/** A staff copy of a gift's file, as a blob for the preview (the token stays in memory, as apiFetch). */
export async function fetchStaffGiftFile(fileId: string): Promise<Blob | null> {
  const token = getAccessToken();
  try {
    const res = await fetch(`${getApiBaseUrl()}/api/v1/staff/fan-gift-files/${fileId}`, {
      credentials: "omit",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    return res.ok ? await res.blob() : null;
  } catch {
    return null;
  }
}

/** A file's address for the person a gift is for, through their own gift link. */
export function giftFileUrl(token: string, fileId: string): string {
  return `${getApiBaseUrl()}/api/v1/gifts/${encodeURIComponent(token)}/files/${fileId}`;
}

export async function fetchFanGiftNotes(): Promise<FanGiftNote[]> {
  return apiFetch<FanGiftNote[]>("/api/v1/staff/fan-gift-notes");
}

export async function reviewFanGiftNote(giftId: string, approve: boolean): Promise<{ id: string; note_state: string; status: string }> {
  return apiFetch(`/api/v1/staff/fan-gift-notes/${giftId}/review`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ approve }),
    retry: false,
  });
}
