import type { OfferRecord, PlanRecord } from "@/lib/api";

/*
 * Pure helpers for the Store and checkout (store.md). No prices are computed: amounts are shown
 * exactly as the API sends them through lib/format/money.
 */

/** Until plans carry display names (OD-22): "premium_monthly" -> "Premium monthly". */
export function planName(key: string): string {
  const words = key.replace(/[_\-.]+/g, " ").trim().toLowerCase();
  return words ? words[0].toUpperCase() + words.slice(1) : "Plan";
}

const UNIT: Record<string, [string, string]> = {
  DAY: ["day", "days"],
  WEEK: ["week", "weeks"],
  MONTH: ["month", "months"],
  YEAR: ["year", "years"],
};

/** "/ month", "/ 3 months". Null when the interval is unknown, so nothing is guessed. */
export function intervalLabel(plan: Pick<PlanRecord, "interval" | "interval_count">): string | null {
  const unit = UNIT[(plan.interval ?? "").toUpperCase()];
  if (!unit) return null;
  const n = plan.interval_count ?? 1;
  return n === 1 ? `/ ${unit[0]}` : `/ ${n} ${unit[1]}`;
}

/** "14-day trial" only when the API sets trial_days. */
export function trialLabel(plan: Pick<PlanRecord, "trial_days">): string | null {
  return plan.trial_days && plan.trial_days > 0 ? `${plan.trial_days}-day trial` : null;
}

export const PRODUCT_TYPE_LABEL: Record<string, string> = {
  TRACK: "Tracks",
  RELEASE: "Albums and EPs",
  CATALOG_ACCESS: "Full catalog",
  SUBSCRIPTION_PLAN: "Plans",
};

/** What one item is: "Track", "Full catalog". */
const PRODUCT_KIND: Record<string, string> = { TRACK: "Track", RELEASE: "Release", CATALOG_ACCESS: "Full catalog", SUBSCRIPTION_PLAN: "Plan" };

export function productKind(type: string | null | undefined): string {
  if (!type) return "Item";
  return PRODUCT_KIND[type] ?? planName(type);
}

export function productTypeLabel(type: string | null | undefined): string {
  if (!type) return "Other";
  return PRODUCT_TYPE_LABEL[type] ?? planName(type);
}

/**
 * Offers grouped by product type, in a stable order (tracks first). Empty groups are dropped.
 * Owners' prices (OWNS_PART_OF_RELEASE) are only offered on their release's page, never here.
 */
export function groupOffers(offers: OfferRecord[]): { type: string; label: string; offers: OfferRecord[] }[] {
  const order = ["TRACK", "RELEASE", "CATALOG_ACCESS", "SUBSCRIPTION_PLAN"];
  const groups = new Map<string, OfferRecord[]>();
  for (const offer of offers) {
    if ((offer.audience ?? "EVERYONE") !== "EVERYONE") continue;
    const key = offer.product_type ?? "OTHER";
    groups.set(key, [...(groups.get(key) ?? []), offer]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => {
      const ia = order.indexOf(a);
      const ib = order.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
    })
    .map(([type, list]) => ({ type, label: type === "OTHER" ? "Other" : productTypeLabel(type), offers: list }));
}

/** The words a Room Cube is built from for an offer: its product name, else its type. */
export function offerTitle(offer: Pick<OfferRecord, "name" | "product_type">): string {
  return offer.name?.trim() || productTypeLabel(offer.product_type);
}

export type CheckoutItem =
  | { kind: "offer"; id: string }
  | { kind: "plan"; id: string }
  | { kind: "tickets"; id: string; eventId?: string };

/** Reads the checkout query: ?offer=, ?plan= or ?ticketTypeId= (the existing ticket link). */
export function checkoutItemFromParams(params: { get(name: string): string | null }): CheckoutItem | null {
  const offer = params.get("offer");
  if (offer) return { kind: "offer", id: offer };
  const plan = params.get("plan");
  if (plan) return { kind: "plan", id: plan };
  const ticket = params.get("ticketTypeId");
  if (ticket) {
    const eventId = params.get("event");
    return eventId ? { kind: "tickets", id: ticket, eventId } : { kind: "tickets", id: ticket };
  }
  return null;
}

/** Where to go after an order completes: straight to listening for music, the tickets for an event. */
export function afterPurchaseHref(
  item: CheckoutItem,
  offer?: { product_type: string | null; subject_id?: string | null } | null,
): { href: string; label: string } {
  if (item.kind === "tickets") return { href: "/tickets", label: "View your tickets" };
  if (item.kind === "plan") return { href: "/releases", label: "Start listening" };
  if (offer?.product_type === "TRACK" && offer.subject_id) return { href: `/tracks/${offer.subject_id}`, label: "Listen now" };
  if (offer?.product_type === "RELEASE" && offer.subject_id) return { href: `/releases/${offer.subject_id}`, label: "Listen now" };
  if (offer?.product_type === "CATALOG_ACCESS") return { href: "/releases", label: "Start listening" };
  return { href: "/purchases", label: "View your purchases" };
}
