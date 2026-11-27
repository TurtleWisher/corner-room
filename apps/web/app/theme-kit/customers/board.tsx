"use client";

import { useState } from "react";

import { CustomersBoard } from "@/components/staff/customer-list";
import { CustomerProfileView } from "@/components/staff/customer-profile";
import type { CustomerList } from "@/features/commerce/api";
import type { CustomerProfile } from "@/lib/customer-profile-view";
import type { CustomerRow } from "@/lib/customers-view";

/* SAMPLE CONTENT ONLY: invented people, songs and payments for the developer board. */
const NOW = new Date("2026-11-27T12:40:00Z");
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString();

function person(p: Partial<CustomerRow> & { key: string; name: string }): CustomerRow {
  return {
    email: `${p.name.toLowerCase().replace(/\s+/g, ".")}@example.com`,
    phone: null,
    address: null,
    user_id: p.key.startsWith("presale-") ? null : p.key,
    account_status: "ACTIVE",
    email_verified: true,
    joined_at: ago(60 * 24 * 20),
    orders: 0,
    spent: {},
    last_order_at: null,
    presales: [],
    sources: ["WEBSITE"],
    account_types: ["fan"],
    manages: [],
    payments: [],
    payment_status: null,
    ...p,
  };
}

const ROWS: CustomerRow[] = [
  person({ key: "u-1", name: "Nadia Rahman", phone: "+8801700000001", address: "Road 4, Dhanmondi, Dhaka", payment_status: "NOT_SENT", last_activity: "CHECKOUT_OPENED", last_activity_at: ago(4), last_activity_items: ["Sample Song"] }),
  person({ key: "u-2", name: "Tanvir Ahmed", orders: 2, spent: { BDT: 22800 }, payment_status: "PAID", last_activity: "PAID", last_activity_at: ago(18), last_activity_items: ["Sample Release"], account_types: ["fan"], sources: ["WEBSITE", "PRESALE"] }),
  person({ key: "u-3", name: "Sample Act Owner", manages: ["Sample Band"], account_types: ["staff", "artist"], orders: 1, spent: { BDT: 11400 }, payment_status: "PAID", last_activity: "PAYMENT_SENT", last_activity_at: ago(95), last_activity_items: ["Sample Song"] }),
  person({ key: "u-4", name: "Farhana Kabir", payment_status: "WAITING", last_activity: "PAYMENT_SENT", last_activity_at: ago(60 * 5), last_activity_items: ["Sample Song"], payments: [{ order_id: "o4", status: "WAITING", items: ["Sample Song"], amount_minor: 11400, currency_code: "BDT", transaction_ref: "SAMPLE0001", paid_from: "+8801700000004", paid_with: "BKASH", decision_note: null, at: ago(60 * 5) }] }),
  person({ key: "u-5", name: "Imran Hossain", payment_status: "REJECTED", last_activity: "PAYMENT_REJECTED", last_activity_at: ago(60 * 26), last_activity_items: ["Sample Release"] }),
  person({ key: "presale-6", name: "Sadia Islam", user_id: null, account_status: null, email_verified: false, joined_at: null, sources: ["PRESALE"], account_types: [], payment_status: "PAID", last_activity: "PRESALE_PAID", last_activity_at: ago(60 * 24 * 3), last_activity_items: ["Sample Release"] }),
  person({ key: "u-7", name: "Rafi Chowdhury", email_verified: false, account_status: "PENDING_VERIFICATION", last_activity: "SIGNED_UP", last_activity_at: ago(60 * 24 * 9) }),
  person({ key: "u-8", name: "Mehnaz Akter", orders: 1, spent: { BDT: 11400 }, payment_status: "REFUNDED", last_activity: "REFUNDED", last_activity_at: ago(60 * 24 * 12), last_activity_items: ["Sample Song"] }),
];

const LIST: CustomerList = { items: ROWS, total: ROWS.length, truncated: false, presale_buyers: 2, website_customers: 7 };

const PROFILE: CustomerProfile = {
  person: {
    key: "u-2",
    user_id: "u-2",
    name: "Tanvir Ahmed",
    email: "tanvir.ahmed@example.com",
    phone: "+8801700000002",
    address: "House 12, Road 3, Mirpur, Dhaka, 1216",
    account_status: "ACTIVE",
    email_verified: true,
    verified_at: ago(60 * 24 * 20),
    joined_at: ago(60 * 24 * 20),
    account_types: ["fan"],
    manages: [],
    sources: ["WEBSITE", "PRESALE"],
    sign_in_methods: ["PASSWORD", "GOOGLE"],
    locale: "en",
    security_locked: false,
  },
  summary: {
    spent: { BDT: 22800 },
    refunded: {},
    credit: { BDT: 11400 },
    payment_status: "PAID",
    orders_paid: 2,
    waiting: 0,
    rejected: 1,
    unfinished: 1,
    refunds: 0,
    owned: 3,
    listens: 47,
    follows: 2,
    gifts_given: 1,
    gifts_received: 0,
    presales: 1,
    last_seen_at: ago(12),
    last_activity_at: ago(18),
  },
  timeline: [
    { at: ago(18), kind: "PAID", title: "Sample Release", amount_minor: 11400, currency_code: "BDT" },
    { at: ago(40), kind: "PAYMENT_SENT", title: "Sample Release", detail: "SAMPLE0002 · +8801700000002 · BKASH", amount_minor: 11400, currency_code: "BDT" },
    { at: ago(44), kind: "CHECKOUT_OPENED", title: "Sample Release", amount_minor: 11400, currency_code: "BDT" },
    { at: ago(50), kind: "ACCOUNT_ACTION", title: "auth.login" },
    { at: ago(60 * 20), kind: "LISTENED", title: "Sample Song", count: 4 },
    { at: ago(60 * 26), kind: "PAYMENT_REJECTED", title: "Sample Song", detail: "Not on the bKash statement", amount_minor: 11400, currency_code: "BDT" },
    { at: ago(60 * 27), kind: "PAYMENT_SENT", title: "Sample Song", detail: "SAMPLE0003 · +8801700000002 · NAGAD", amount_minor: 11400, currency_code: "BDT" },
    { at: ago(60 * 27 + 3), kind: "CHECKOUT_OPENED", title: "Sample Song", amount_minor: 11400, currency_code: "BDT" },
    { at: ago(60 * 24 * 4), kind: "GIFT_GIVEN", title: "Sample Song", count: 1 },
    { at: ago(60 * 24 * 5), kind: "EMAIL_FROM_ACT", title: "Thank you for listening", detail: "Sample Band" },
    { at: ago(60 * 24 * 6), kind: "FOLLOWED", title: "Sample Band" },
    { at: ago(60 * 24 * 8), kind: "ACCOUNT_ACTION", title: "delivery_address.saved" },
    { at: ago(60 * 24 * 10), kind: "PRESALE_CLAIMED", title: "Sample Release" },
    { at: ago(60 * 24 * 20), kind: "EMAIL_VERIFIED", title: "" },
    { at: ago(60 * 24 * 20 + 2), kind: "SIGNED_UP", title: "" },
    { at: ago(60 * 24 * 30), kind: "PRESALE_PAID", title: "Sample Release", detail: "2026-10-28", amount_minor: 11400, currency_code: "BDT" },
  ],
  timeline_truncated: false,
  orders: [
    {
      order_id: "0f6e1a52-0000-4000-8000-000000000002",
      status: "PAID",
      order_status: "FULFILLED",
      purpose: "RELEASE",
      is_presale: false,
      is_gift: false,
      is_music_gift: false,
      paid_with_credit_minor: 0,
      amount_minor: 11400,
      currency_code: "BDT",
      created_at: ago(44),
      updated_at: ago(18),
      items: [{ name: "Sample Release", kind: "RELEASE", quantity: 1, amount_minor: 11400, currency_code: "BDT" }],
      submissions: [{ status: "CONFIRMED", transaction_ref: "SAMPLE0002", paid_from: "+8801700000002", paid_with: "BKASH", sent_at: ago(40), decided_at: ago(18), decision_note: null }],
      refunds: [],
      delivery_address: null,
    },
    {
      order_id: "0f6e1a52-0000-4000-8000-000000000003",
      status: "REJECTED",
      order_status: "PENDING_PAYMENT",
      purpose: "TRACK",
      is_presale: false,
      is_gift: false,
      is_music_gift: false,
      paid_with_credit_minor: 0,
      amount_minor: 11400,
      currency_code: "BDT",
      created_at: ago(60 * 27 + 3),
      updated_at: ago(60 * 26),
      items: [{ name: "Sample Song", kind: "TRACK", quantity: 1, amount_minor: 11400, currency_code: "BDT" }],
      submissions: [{ status: "REJECTED", transaction_ref: "SAMPLE0003", paid_from: "+8801700000002", paid_with: "NAGAD", sent_at: ago(60 * 27), decided_at: ago(60 * 26), decision_note: "Not on the bKash statement" }],
      refunds: [],
      delivery_address: null,
    },
    {
      order_id: "0f6e1a52-0000-4000-8000-000000000004",
      status: "PAID",
      order_status: "FULFILLED",
      purpose: "TRACK",
      is_presale: false,
      is_gift: true,
      is_music_gift: false,
      paid_with_credit_minor: 0,
      amount_minor: 11400,
      currency_code: "BDT",
      created_at: ago(60 * 24 * 4 + 10),
      updated_at: ago(60 * 24 * 4),
      items: [{ name: "Sample Song", kind: "TRACK", quantity: 1, amount_minor: 11400, currency_code: "BDT" }],
      submissions: [{ status: "CONFIRMED", transaction_ref: "SAMPLE0004", paid_from: "+8801700000002", paid_with: "BKASH", sent_at: ago(60 * 24 * 4 + 5), decided_at: ago(60 * 24 * 4), decision_note: null }],
      refunds: [],
      delivery_address: "House 12, Road 3, Mirpur, Dhaka, 1216",
    },
  ],
  presales: [{ product: "Sample Release", amount_minor: 11400, currency_code: "BDT", paid_on: "2026-10-28", status: "CLAIMED", claimed_at: ago(60 * 24 * 10), listed_at: ago(60 * 24 * 30) }],
  library: [
    { title: "Sample Release", kind: "RELEASE", status: "ACTIVE", source: "ORDER", since: ago(18) },
    { title: "Sample Song", kind: "TRACK", status: "ACTIVE", source: "PRESALE", since: ago(60 * 24 * 10) },
  ],
  top_songs: [
    { title: "Sample Song", listens: 31, last_at: ago(60 * 20) },
    { title: "Another Sample Song", listens: 12, last_at: ago(60 * 48) },
    { title: "A Third Sample", listens: 4, last_at: ago(60 * 72) },
  ],
  follows: [
    { name: "Sample Band", kind: "BAND", since: ago(60 * 24 * 6), active: true },
    { name: "Sample Artist", kind: "ARTIST", since: ago(60 * 24 * 15), active: true },
  ],
  gifts_given: [{ music: "Sample Song", status: "DELIVERED", people: 1, people_states: ["GIVEN"], amount_minor: 11400, currency_code: "BDT", at: ago(60 * 24 * 4) }],
  gifts_received: [],
  emails: [{ from_name: "Sample Band", subject: "Thank you for listening", kind: "THANK_YOU", status: "SENT", at: ago(60 * 24 * 5) }],
  sign_ins: [
    { signed_in_at: ago(50), last_used_at: ago(12), device: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1", active: true },
    { signed_in_at: ago(60 * 24 * 8), last_used_at: ago(60 * 24 * 7), device: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36", active: false },
  ],
};

export function CustomersKitBoard() {
  const [view, setView] = useState<"list" | "person">("list");
  return (
    <div className="grid gap-6">
      <div className="flex gap-2" role="group" aria-label="Sample screen">
        <button type="button" className="cx-chip cr-cut cr-focus" aria-pressed={view === "list"} onClick={() => setView("list")}>
          Customers and users
        </button>
        <button type="button" className="cx-chip cr-cut cr-focus" aria-pressed={view === "person"} onClick={() => setView("person")}>
          One person
        </button>
      </div>
      {view === "list" ? (
        <CustomersBoard
          customers={LIST}
          followers={null}
          now={NOW}
          csvName="corner-room-customers-sample.csv"
          onRefresh={() => undefined}
          scope={
            <select className="h-9 min-w-0 flex-1 border border-line bg-surface px-2 text-sm sm:w-56" aria-label="Whose list" defaultValue="all">
              <option value="all">Everyone</option>
            </select>
          }
        />
      ) : (
        <CustomerProfileView data={PROFILE} now={NOW} />
      )}
    </div>
  );
}
