/*
 * Fan gifts and gift credit (owner, 2026-11-20, D-GIFT-FAN-01). Buying a gift and paying with
 * credit go through POST /orders (`gift`, `use_credit`); the server decides every total.
 */

import { apiFetch } from "@/lib/api/client";
import type { OrderRecord } from "@/features/ticketing/api";

export type MoneyValue = { amount_minor: number; currency_code: string };

export type GiftPerson = { email: string; name?: string | null };

export type GiftStatus = "WAITING" | "GIVEN" | "WAITING_ACCOUNT" | "CHOOSING" | "KEPT_CREDIT" | "PASSED_ON" | "DECLINED" | "EXPIRED";

export type GiftChoice = "KEEP_CREDIT" | "PASS_ON" | "DECLINE";

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
  for_email: string;
  viewer: "RECIPIENT" | "SIGNED_IN" | "SIGNED_OUT";
  status: GiftStatus | null;
  expires_at: string | null;
  amount: MoneyValue | null;
  credit: MoneyValue | null;
  spend_on: SpendOption[];
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
  people: { email: string; name: string | null; state: GiverState }[];
};

export type GiftCredit = { act_id: string; act_name: string; balance: MoneyValue };

export type OfferCredit = { usable: boolean; balance: MoneyValue | null; act_name: string | null };

export type FanGiftNote = {
  id: string;
  note: string | null;
  title: string;
  act_name: string;
  giver_name: string | null;
  people: number;
  paid_at: string | null;
};

export async function createGiftOrder(
  offerId: string,
  idempotencyKey: string,
  gift: { people: GiftPerson[]; note: string | null },
  amountMinor?: number,
): Promise<OrderRecord> {
  return apiFetch<OrderRecord>("/api/v1/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({ offer_id: offerId, gift, ...(amountMinor === undefined ? {} : { amount_minor: amountMinor }) }),
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
