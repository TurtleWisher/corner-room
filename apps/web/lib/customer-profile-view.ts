/**
 * Customers and users, redesigned (owner, 2026-11-27, D-CUSTOMERS-03): the list says in plain words
 * what each person did last, and each person opens on their own page with their whole story. Pure
 * helpers: words, tones, grouping and filters. The server decides who is listed, counts and adds
 * up every number; nothing here computes money.
 */

import type { StatusTone } from "@/lib/format/status";
import { PAYMENT_STATUS_LABEL, type CustomerRow, type PaymentStatus } from "@/lib/customers-view";

// ---------- what happened ----------

export type ActivityKind =
  | "SIGNED_UP"
  | "EMAIL_VERIFIED"
  | "CHECKOUT_OPENED"
  | "PAYMENT_SENT"
  | "PAID"
  | "PAYMENT_REJECTED"
  | "CHECKOUT_EXPIRED"
  | "REFUND"
  | "REFUNDED"
  | "PRESALE_PAID"
  | "PRESALE_CLAIMED"
  | "LISTENED"
  | "FOLLOWED"
  | "GIFT_GIVEN"
  | "GIFT_RECEIVED"
  | "EMAIL_FROM_ACT"
  | "ACCOUNT_ACTION";

/** The verb for each moment, and its tone: good news, waiting on staff, a problem, or quiet. */
export const ACTIVITY: Record<ActivityKind, { words: string; tone: StatusTone; group: TimelineGroup }> = {
  SIGNED_UP: { words: "Joined Corner Room", tone: "info", group: "account" },
  EMAIL_VERIFIED: { words: "Confirmed their email", tone: "info", group: "account" },
  CHECKOUT_OPENED: { words: "Opened the payment page", tone: "neutral", group: "payments" },
  PAYMENT_SENT: { words: "Sent a payment to check", tone: "warning", group: "payments" },
  PAID: { words: "Paid", tone: "positive", group: "payments" },
  PAYMENT_REJECTED: { words: "Payment rejected", tone: "negative", group: "payments" },
  CHECKOUT_EXPIRED: { words: "Checkout expired unpaid", tone: "neutral", group: "payments" },
  REFUND: { words: "Refund", tone: "accent", group: "payments" },
  REFUNDED: { words: "Refunded", tone: "accent", group: "payments" },
  PRESALE_PAID: { words: "Paid before launch (pre-sale sheet)", tone: "positive", group: "payments" },
  PRESALE_CLAIMED: { words: "Pre-sale music unlocked on their account", tone: "positive", group: "music" },
  LISTENED: { words: "Listened to", tone: "neutral", group: "music" },
  FOLLOWED: { words: "Followed", tone: "neutral", group: "music" },
  GIFT_GIVEN: { words: "Gave a gift", tone: "accent", group: "gifts" },
  GIFT_RECEIVED: { words: "Received a gift", tone: "accent", group: "gifts" },
  EMAIL_FROM_ACT: { words: "Email from an act", tone: "neutral", group: "gifts" },
  ACCOUNT_ACTION: { words: "Account", tone: "neutral", group: "account" },
};

export function activityOf(kind: string | null | undefined) {
  return (kind && ACTIVITY[kind as ActivityKind]) || null;
}

/** "Opened the payment page for Chaya Pore", for the list's last-activity line. */
export function lastActivityLine(kind: string | null | undefined, items: string[] = []): string {
  const a = activityOf(kind);
  if (!a) return "No activity yet";
  const what = items.filter(Boolean).join(", ");
  if (!what) return a.words;
  if (kind === "PAID" || kind === "REFUNDED") return `${a.words} for ${what}`;
  if (kind === "PRESALE_PAID") return `Paid before launch for ${what}`;
  return `${a.words} for ${what}`;
}

// ---------- account actions (the person's own audited actions) ----------

const ACCOUNT_WORDS: Record<string, string> = {
  "auth.login": "Signed in",
  "auth.login_failed": "Tried to sign in, wrong password",
  "auth.logout": "Signed out",
  "auth.password_changed": "Changed their password",
  "auth.password_reset": "Reset their password",
  "auth.password_recovery_requested": "Asked for a password reset link",
  "auth.verification_requested": "Asked for a new confirmation email",
  "auth.refresh_replay": "An old sign-in was reused (signed out for safety)",
  "session.revoked": "Signed out a device",
  "session.revoked_all": "Signed out everywhere",
  "identity.external_linked": "Linked Google sign-in",
  "customer_profile.updated": "Changed their name or language",
  "customer_profile.avatar_changed": "Changed their picture",
  "customer_profile.avatar_removed": "Removed their picture",
  "delivery_address.saved": "Saved a delivery address",
  "library.liked": "Liked a song",
  "playlist.created": "Made a playlist",
  "artist_application.submitted": "Applied to be an artist",
  "track.download.granted": "Downloaded a song",
  "organization.workspace_switched": "Switched workspace",
  "organization.invitation_accepted": "Accepted a staff or team invitation",
};

/** Plain words for one recorded action; unknown ones are made readable, never hidden. */
export function accountActionWords(action: string): string {
  if (ACCOUNT_WORDS[action]) return ACCOUNT_WORDS[action];
  const [subject = "", verb = ""] = action.split(".");
  const words = `${subject.replace(/_/g, " ")} ${verb.replace(/_/g, " ")}`.trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Account activity";
}

// ---------- time ----------

/** "just now", "5 min ago", "3 h ago", "yesterday", "4 days ago"; null after a week (show the date). */
export function timeAgo(at: string | null | undefined, now: Date): string | null {
  if (!at) return null;
  const then = new Date(at).getTime();
  if (Number.isNaN(then)) return null;
  const sec = Math.max(0, Math.round((now.getTime() - then) / 1000));
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return "yesterday";
  if (d < 7) return `${d} days ago`;
  return null;
}

/** Whether something happened within the last `minutes` (the list marks people active now). */
export function isRecent(at: string | null | undefined, now: Date, minutes = 30): boolean {
  if (!at) return false;
  const then = new Date(at).getTime();
  return !Number.isNaN(then) && now.getTime() - then >= 0 && now.getTime() - then < minutes * 60_000;
}

/** The day key in Dhaka time (D-TIME-01), so a timeline groups by the owner's calendar. */
export function dhakaDay(at: string): string {
  const d = new Date(new Date(at).getTime() + 6 * 3600_000);
  return d.toISOString().slice(0, 10);
}

/** "Today", "Yesterday" or null (show the date) for a Dhaka day key. */
export function dayWord(day: string, now: Date): string | null {
  const today = dhakaDay(now.toISOString());
  if (day === today) return "Today";
  const y = dhakaDay(new Date(now.getTime() - 86_400_000).toISOString());
  return day === y ? "Yesterday" : null;
}

// ---------- devices ----------

/** "Chrome on Windows", "Safari on iPhone"; "Unknown device" when the browser said nothing. */
export function deviceLabel(ua: string | null | undefined): string {
  if (!ua) return "Unknown device";
  const os = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Windows/.test(ua)
          ? "Windows"
          : /Mac OS X|Macintosh/.test(ua)
            ? "Mac"
            : /Linux/.test(ua)
              ? "Linux"
              : null;
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\/|Opera/.test(ua)
      ? "Opera"
      : /SamsungBrowser/.test(ua)
        ? "Samsung Internet"
        : /FBAN|FBAV|FB_IAB/.test(ua)
          ? "Facebook app"
          : /Instagram/.test(ua)
            ? "Instagram app"
            : /Firefox\//.test(ua)
              ? "Firefox"
              : /Chrome\/|CriOS/.test(ua)
                ? "Chrome"
                : /Safari\//.test(ua)
                  ? "Safari"
                  : null;
  if (browser && os) return `${browser} on ${os}`;
  return browser ?? os ?? "Unknown device";
}

// ---------- payments ----------

export const PAYMENT_TONE: Record<PaymentStatus, StatusTone> = {
  PAID: "positive",
  WAITING: "warning",
  REJECTED: "negative",
  EXPIRED: "neutral",
  NOT_SENT: "neutral",
  REFUNDED: "accent",
};

export function paymentTone(status: string | null | undefined): StatusTone {
  return (status && PAYMENT_TONE[status as PaymentStatus]) || "neutral";
}

/** Short words for the small status pill, so it never runs into the next column. */
const PAYMENT_SHORT: Record<PaymentStatus, string> = {
  PAID: "Paid",
  WAITING: "Waiting for check",
  REJECTED: "Rejected",
  EXPIRED: "Expired",
  NOT_SENT: "Opened, not paid",
  REFUNDED: "Refunded",
};

export function paymentShort(status: string | null | undefined): string {
  if (!status) return "Never ordered";
  return PAYMENT_SHORT[status as PaymentStatus] ?? paymentLabel(status);
}

export function paymentLabel(status: string | null | undefined): string {
  if (!status) return "Never ordered";
  return PAYMENT_STATUS_LABEL[status as PaymentStatus] ?? status;
}

export function paidWithLabel(v: string | null | undefined): string | null {
  if (!v) return null;
  const words: Record<string, string> = { BKASH: "bKash", NAGAD: "Nagad", ROCKET: "Rocket", UPAY: "Upay", BANK_APP: "Bank app", OTHER: "Other" };
  return words[v] ?? v;
}

// Reasons are data (refund policies); only the one the server writes itself gets fixed words.
const REFUND_REASON: Record<string, string> = { PRESALE_CANCELLED: "Pre-sale cancelled" };

export function refundReason(code: string): string {
  return REFUND_REASON[code] ?? code.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase());
}

const GIFT_STATE: Record<string, string> = {
  WAITING: "Waiting",
  GIVEN: "Delivered",
  WAITING_ACCOUNT: "Waiting for them to sign up",
  CHOOSING: "Choosing",
  KEPT_CREDIT: "Kept as credit",
  PASSED_ON: "Passed on",
  DECLINED: "Declined",
  EXPIRED: "Not claimed",
  ALREADY_OWNED: "Already owned it",
  PENDING_PAYMENT: "Not paid yet",
  WAITING_NOTE: "Note waiting for staff",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
};

export function giftState(s: string): string {
  return GIFT_STATE[s] ?? s;
}

export const ACCOUNT_STATUS: Record<string, { label: string; tone: StatusTone }> = {
  ACTIVE: { label: "Active", tone: "positive" },
  PENDING_VERIFICATION: { label: "Email not confirmed", tone: "warning" },
  SUSPENDED: { label: "Suspended", tone: "negative" },
  CLOSED: { label: "Closed", tone: "neutral" },
};

// ---------- the list ----------

export type StatusChipKey = "all" | "active_now" | PaymentStatus | "none";

/** How many people sit in each status chip (counting only, D-P16-03 money stays on the server). */
export function statusCounts(rows: CustomerRow[], now: Date): Record<StatusChipKey, number> {
  const counts: Record<StatusChipKey, number> = {
    all: rows.length,
    active_now: 0,
    PAID: 0,
    WAITING: 0,
    NOT_SENT: 0,
    REJECTED: 0,
    EXPIRED: 0,
    REFUNDED: 0,
    none: 0,
  };
  for (const r of rows) {
    if (isRecent(r.last_activity_at, now)) counts.active_now += 1;
    if (!r.payment_status) counts.none += 1;
    const seen = new Set((r.payments ?? []).map((p) => p.status));
    if (r.payment_status) seen.add(r.payment_status);
    for (const s of seen) counts[s] += 1;
  }
  return counts;
}

export function matchesChip(r: CustomerRow, chip: StatusChipKey, now: Date): boolean {
  if (chip === "all") return true;
  if (chip === "active_now") return isRecent(r.last_activity_at, now);
  if (chip === "none") return !r.payment_status;
  return r.payment_status === chip || (r.payments ?? []).some((p) => p.status === chip);
}

/** Instant search over what the list already holds: name, email, phone, address, the acts an
 * account runs, and what they typed when paying (transaction ID, paid-from number). */
export function searchRows(rows: CustomerRow[], q: string): CustomerRow[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return rows;
  const digits = needle.replace(/\D/g, "");
  return rows.filter((r) => {
    const fields = [r.name, r.email, r.phone, r.address, ...(r.manages ?? []), ...(r.last_activity_items ?? [])]
      .concat((r.payments ?? []).flatMap((p) => [p.transaction_ref, p.paid_from, ...p.items]))
      .filter((f): f is string => Boolean(f));
    if (fields.some((f) => f.toLowerCase().includes(needle))) return true;
    // "01712 345678" finds "+8801712345678".
    return digits.length >= 5 && fields.some((f) => f.replace(/\D/g, "").includes(digits));
  });
}

/** Keys whose last activity is newer than last time the list was loaded (they light up once). */
export function freshKeys(before: CustomerRow[] | null, after: CustomerRow[]): Set<string> {
  if (!before) return new Set();
  const was = new Map(before.map((r) => [r.key, r.last_activity_at ?? null]));
  return new Set(after.filter((r) => !was.has(r.key) || was.get(r.key) !== (r.last_activity_at ?? null)).map((r) => r.key));
}

/** The person's page; the key is an account id or "presale-<id>", never an email. */
export function profileHref(key: string): string {
  return `/staff/customers/${encodeURIComponent(key)}`;
}

/** Two-letter monogram fallback text for a row with no name. */
export function displayName(r: { name: string | null; email: string | null }): string {
  return r.name?.trim() || r.email?.split("@")[0] || "No name";
}

// ---------- the person's page ----------

export type TimelineGroup = "payments" | "music" | "gifts" | "account";

export const TIMELINE_FILTERS: { key: "all" | TimelineGroup; label: string }[] = [
  { key: "all", label: "Everything" },
  { key: "payments", label: "Payments" },
  { key: "music", label: "Music and listening" },
  { key: "gifts", label: "Gifts and emails" },
  { key: "account", label: "Account and sign-ins" },
];

export type Moment = {
  at: string;
  kind: string;
  title: string;
  detail?: string | null;
  amount_minor?: number | null;
  currency_code?: string | null;
  order_id?: string | null;
  count?: number | null;
};

/** The headline and the small line under it for one moment on the timeline. */
export function momentWords(m: Moment): { headline: string; sub: string | null } {
  const a = activityOf(m.kind);
  if (m.kind === "ACCOUNT_ACTION") return { headline: accountActionWords(m.title), sub: null };
  if (m.kind === "LISTENED") {
    const times = m.count && m.count > 1 ? ` (${m.count} listens that day)` : "";
    return { headline: `Listened to ${m.title || "a song"}${times}`, sub: null };
  }
  if (m.kind === "FOLLOWED") return { headline: `Followed ${m.title || "an act"}`, sub: null };
  if (m.kind === "GIFT_GIVEN") {
    const people = m.count ? ` to ${m.count} ${m.count === 1 ? "person" : "people"}` : "";
    return { headline: `Gave ${m.title || "music"} as a gift${people}`, sub: null };
  }
  if (m.kind === "GIFT_RECEIVED") return { headline: `Received ${m.title || "music"} as a gift`, sub: m.detail ? `From ${m.detail}` : null };
  if (m.kind === "EMAIL_FROM_ACT") return { headline: `Email from ${m.detail || "an act"}`, sub: m.title ? `“${m.title}”` : null };
  if (m.kind === "REFUND") return { headline: `Refund ${refundState(m.detail)}`, sub: m.title || null };
  if (m.kind === "PAYMENT_SENT") {
    const [ref, from, via] = (m.detail ?? "").split(" · ");
    const parts = [ref ? `ID ${ref}` : null, from ? `from ${from}` : null, paidWithLabel(via) ? `via ${paidWithLabel(via)}` : null].filter(Boolean);
    return { headline: `${a?.words ?? m.kind}${m.title ? ` for ${m.title}` : ""}`, sub: parts.join(" · ") || null };
  }
  if (m.kind === "PAYMENT_REJECTED") return { headline: `${a?.words}${m.title ? ` for ${m.title}` : ""}`, sub: m.detail ? `Reason: ${m.detail}` : null };
  if (m.kind === "PRESALE_PAID") return { headline: `${a?.words}${m.title ? `: ${m.title}` : ""}`, sub: m.detail ? `Paid on ${m.detail}` : null };
  if (m.kind === "PRESALE_CLAIMED") return { headline: a?.words ?? m.kind, sub: m.title || null };
  if (a) return { headline: m.title ? `${a.words} for ${m.title}` : a.words, sub: m.detail ?? null };
  return { headline: m.kind.replace(/_/g, " ").toLowerCase(), sub: m.title || null };
}

function refundState(s: string | null | undefined): string {
  const w: Record<string, string> = {
    REQUESTED: "asked for",
    APPROVED: "approved",
    PROCESSING: "being paid back",
    COMPLETED: "paid back",
    REJECTED: "turned down",
  };
  return (s && w[s]) || "recorded";
}

export function momentGroup(kind: string): TimelineGroup {
  return activityOf(kind)?.group ?? "account";
}

export function filterMoments(moments: Moment[], group: "all" | TimelineGroup, q: string): Moment[] {
  const needle = q.trim().toLowerCase();
  return moments.filter((m) => {
    if (group !== "all" && momentGroup(m.kind) !== group) return false;
    if (!needle) return true;
    const { headline, sub } = momentWords(m);
    return `${headline} ${sub ?? ""} ${m.title} ${m.detail ?? ""}`.toLowerCase().includes(needle);
  });
}

/** Moments grouped by Dhaka day, newest day first; order inside a day is kept. */
export function byDay(moments: Moment[]): { day: string; moments: Moment[] }[] {
  const out: { day: string; moments: Moment[] }[] = [];
  for (const m of moments) {
    const day = dhakaDay(m.at);
    const last = out[out.length - 1];
    if (last && last.day === day) last.moments.push(m);
    else out.push({ day, moments: [m] });
  }
  return out;
}

/** One line on what a person's money looks like, for screen readers and the hero. */
export function currencies(map: Record<string, number> | null | undefined): { amount_minor: number; currency_code: string }[] {
  return Object.entries(map ?? {})
    .filter(([, v]) => v !== 0)
    .map(([currency_code, amount_minor]) => ({ amount_minor, currency_code }));
}

// ---------- the page's data (GET /staff/customers/{key}) ----------

export type MoneyMap = Record<string, number>;

export type CustomerProfile = {
  person: {
    key: string;
    picture_url?: string | null;
    /** Artists and bands this account runs, with their approved pictures. */
    acts?: { id: string; name: string; picture_url: string | null }[];
    user_id: string | null;
    name: string | null;
    email: string | null;
    phone: string | null;
    address: string | null;
    account_status: string | null;
    email_verified: boolean;
    verified_at: string | null;
    joined_at: string | null;
    account_types: string[];
    manages: string[];
    sources: string[];
    sign_in_methods: string[];
    locale: string | null;
    security_locked: boolean;
  };
  summary: {
    spent: MoneyMap;
    refunded: MoneyMap;
    credit: MoneyMap;
    payment_status: string | null;
    orders_paid: number;
    waiting: number;
    rejected: number;
    unfinished: number;
    refunds: number;
    owned: number;
    listens: number;
    follows: number;
    gifts_given: number;
    gifts_received: number;
    presales: number;
    last_seen_at: string | null;
    last_activity_at: string | null;
  };
  timeline: Moment[];
  timeline_truncated: boolean;
  orders: ProfileOrder[];
  presales: { product: string | null; amount_minor: number; currency_code: string; paid_on: string | null; status: string; claimed_at: string | null; listed_at: string }[];
  library: { title: string; kind: string; status: string; source: string | null; since: string }[];
  top_songs: { title: string; listens: number; last_at: string | null }[];
  follows: { name: string; picture_url?: string | null; kind: string; since: string; active: boolean }[];
  gifts_given: { music: string; status: string; people: number; people_states: string[]; amount_minor: number; currency_code: string; at: string }[];
  gifts_received: { music: string | null; from: string | null; from_picture_url?: string | null; kind: string; status: string; at: string }[];
  emails: { from_name: string; from_picture_url?: string | null; subject: string; kind: string; status: string; at: string }[];
  sign_ins: { signed_in_at: string; last_used_at: string | null; device: string | null; active: boolean }[];
};

export type ProfileOrder = {
  order_id: string;
  status: string;
  order_status: string;
  purpose: string;
  is_presale: boolean;
  is_gift: boolean;
  is_music_gift: boolean;
  paid_with_credit_minor: number;
  amount_minor: number;
  currency_code: string;
  created_at: string;
  updated_at: string | null;
  items: { name: string; kind: string; quantity: number; amount_minor: number; currency_code: string }[];
  submissions: {
    status: string;
    transaction_ref: string;
    paid_from: string;
    paid_with: string;
    sent_at: string;
    decided_at: string | null;
    decision_note: string | null;
  }[];
  refunds: { status: string; amount_minor: number; currency_code: string; reason_code: string; requested_at: string }[];
  delivery_address: string | null;
};

export type StepState = "done" | "wait" | "bad" | "todo";

/** The four steps of one order: opened the payment page, sent a payment, staff checked it, paid. */
export function orderSteps(o: ProfileOrder): { label: string; state: StepState }[] {
  const sent = o.submissions.length > 0;
  const last = o.submissions[o.submissions.length - 1];
  const paid = o.status === "PAID" || o.status === "REFUNDED";
  // Paid without a check: gift credit, a ৳0 order, or paid by a provider.
  const noCheckNeeded = paid && !sent;
  return [
    { label: "Opened payment page", state: "done" },
    {
      label: noCheckNeeded ? "No payment to send" : "Sent payment",
      state: sent || noCheckNeeded ? "done" : o.status === "EXPIRED" ? "bad" : "todo",
    },
    {
      label: last?.status === "REJECTED" ? "Rejected by staff" : "Checked by staff",
      state: noCheckNeeded || last?.status === "CONFIRMED" ? "done" : last?.status === "REJECTED" ? "bad" : sent ? "wait" : "todo",
    },
    {
      label: o.status === "REFUNDED" ? "Paid, then refunded" : o.status === "EXPIRED" ? "Expired unpaid" : o.status === "REJECTED" ? "Not paid" : "Paid",
      state: paid ? "done" : o.status === "EXPIRED" || o.status === "REJECTED" ? "bad" : "todo",
    },
  ];
}

/** "Song", "Release", "Ticket" for an order line. */
export function itemKind(kind: string): string {
  const w: Record<string, string> = { TRACK: "Song", RELEASE: "Release", TICKET: "Ticket", SUBSCRIPTION: "Subscription (retired)" };
  return w[kind] ?? kind;
}

/** Share of the most-played song, 0 to 1, for the small bars in "What they listen to". */
export function listenShare(n: number, top: number): number {
  return top > 0 ? Math.min(1, Math.max(0, n / top)) : 0;
}
