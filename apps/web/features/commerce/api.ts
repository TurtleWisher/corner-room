/* Offers, products, plans, subscriptions and entitlements. Split from lib/api.ts (Phase 16, Stage 5). */

import { type Page } from "@/features/identity/api";
import { type OrderRecord } from "@/features/ticketing/api";
import { apiFetch } from "@/lib/api/client";

export type OfferRecord = {
  id: string;
  organization_id: string;
  product_id: string;
  product_type: string | null;
  name: string | null;
  /** What the offer sells: the track id for TRACK products (OD-27). */
  subject_id?: string | null;
  amount_minor: number;
  currency_code: string;
  status: string;
  version: number | null;
};

export type ProductRecord = {
  id: string;
  organization_id: string;
  product_type: string;
  subject_id: string;
  name: string;
  status: string;
  version: number;
};

export type PlanRecord = {
  id: string;
  key: string;
  status: string;
  price_amount_minor: number;
  currency_code: string;
  interval: string;
  interval_count: number;
  trial_days: number | null;
  version_number: number | null;
};

export type SubscriptionRecord = {
  id: string;
  plan_id: string;
  plan_version_id: string;
  status: string;
  cancel_at_period_end: boolean;
  period_ends_at: string | null;
};

export type EntitlementRecord = {
  id: string;
  entitlement_type: string;
  ref_id: string;
  scope: string;
  status: string;
  expires_at: string | null;
};

export async function fetchOffers(): Promise<Page<OfferRecord>> {
  return apiFetch<Page<OfferRecord>>("/api/v1/offers", { retry: false, skipAuth: true, skipRefresh: true });
}

export async function fetchSubscriptionPlans(): Promise<Page<PlanRecord>> {
  return apiFetch<Page<PlanRecord>>("/api/v1/subscription-plans", {
    retry: false,
    skipAuth: true,
    skipRefresh: true,
  });
}

export async function createSubscriptionOrder(plan_id: string, idempotencyKey: string): Promise<OrderRecord> {
  return apiFetch<OrderRecord>("/api/v1/subscriptions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({ plan_id }),
    retry: false,
  });
}

export async function fetchMySubscription(): Promise<SubscriptionRecord> {
  return apiFetch<SubscriptionRecord>("/api/v1/me/subscription", { retry: false });
}

export async function fetchMySubscriptions(): Promise<Page<SubscriptionRecord>> {
  return apiFetch<Page<SubscriptionRecord>>("/api/v1/me/subscriptions", { retry: false });
}

export async function cancelSubscription(id: string): Promise<SubscriptionRecord> {
  return apiFetch<SubscriptionRecord>(`/api/v1/subscriptions/${id}/cancel`, {
    method: "POST",
    retry: false,
  });
}

export async function fetchMyEntitlements(): Promise<Page<EntitlementRecord>> {
  return apiFetch<Page<EntitlementRecord>>("/api/v1/me/entitlements", { retry: false });
}

export async function fetchStaffProducts(): Promise<Page<ProductRecord>> {
  return apiFetch<Page<ProductRecord>>("/api/v1/products", { retry: false });
}

export async function fetchStaffPlans(): Promise<Page<PlanRecord>> {
  return apiFetch<Page<PlanRecord>>("/api/v1/staff/subscription-plans", { retry: false });
}

export async function createProduct(body: {
  product_type: string;
  subject_id: string;
  name: string;
}): Promise<ProductRecord> {
  return apiFetch<ProductRecord>("/api/v1/products", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    retry: false,
  });
}

export async function transitionProduct(id: string, action: string, version?: number): Promise<ProductRecord> {
  return apiFetch<ProductRecord>(`/api/v1/products/${id}/lifecycle`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, version }),
    retry: false,
  });
}

export async function createOffer(body: {
  product_id: string;
  amount_minor: number;
  currency_code: string;
}): Promise<OfferRecord> {
  return apiFetch<OfferRecord>("/api/v1/offers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    retry: false,
  });
}

export async function transitionOffer(id: string, action: string, version?: number): Promise<OfferRecord> {
  return apiFetch<OfferRecord>(`/api/v1/offers/${id}/lifecycle`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, version }),
    retry: false,
  });
}

export async function createPlan(body: {
  key: string;
  price_amount_minor: number;
  currency_code: string;
  interval: string;
  interval_count: number;
  trial_days?: number | null;
}): Promise<PlanRecord> {
  return apiFetch<PlanRecord>("/api/v1/subscription-plans", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    retry: false,
  });
}

export async function transitionPlan(id: string, action: string): Promise<PlanRecord> {
  return apiFetch<PlanRecord>(`/api/v1/subscription-plans/${id}/lifecycle`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
    retry: false,
  });
}
