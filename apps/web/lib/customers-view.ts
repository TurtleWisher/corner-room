/**
 * Customers and users for staff (owner, 2026-10-27, D-CUSTOMERS-01; payments and account types
 * 2026-10-28, D-CUSTOMERS-02): filters applied before a CSV download, and the CSV itself. Pure
 * helpers; the server decides who may see the list and which people are in it.
 */

export type CustomerPresale = { product: string | null; amount_minor: number; currency_code: string; paid_on: string | null; status: string };

/** One order and how its payment stands. */
export type CustomerPayment = {
  order_id: string;
  status: PaymentStatus;
  items: string[];
  amount_minor: number;
  currency_code: string;
  /** What the buyer typed when paying, if they sent a payment. */
  transaction_ref: string | null;
  paid_from: string | null;
  paid_with: string | null;
  decision_note: string | null;
  at: string;
};

export type PaymentStatus = "PAID" | "REFUNDED" | "WAITING" | "REJECTED" | "EXPIRED" | "NOT_SENT";
export type AccountType = "fan" | "artist" | "staff";

/** Words for staff, in the order the filter offers them. */
export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  PAID: "Paid",
  WAITING: "Waiting for check",
  REJECTED: "Rejected",
  EXPIRED: "Expired",
  NOT_SENT: "Started, no payment sent",
  REFUNDED: "Refunded",
};

export const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = { fan: "Fan", artist: "Artist or band", staff: "Staff" };

/** "Paid with Other · AUTULGIFT2026 · from +8801990428674", for one order. */
export function paymentLine(p: CustomerPayment): string {
  const parts = [PAYMENT_STATUS_LABEL[p.status] ?? p.status];
  if (p.items.length) parts.push(p.items.join(", "));
  if (p.transaction_ref) parts.push(`ID ${p.transaction_ref}`);
  if (p.paid_from) parts.push(`from ${p.paid_from}`);
  if (p.paid_with) parts.push(`via ${p.paid_with === "BANK_APP" ? "bank app" : p.paid_with.toLowerCase()}`);
  if (p.decision_note) parts.push(`note: ${p.decision_note}`);
  return parts.join(" · ");
}

export type CustomerRow = {
  key: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  user_id: string | null;
  account_status: string | null;
  email_verified: boolean;
  joined_at: string | null;
  orders: number;
  spent: Record<string, number>;
  last_order_at: string | null;
  presales: CustomerPresale[];
  sources: string[];
  /** Artist and band names the account manages. */
  manages?: string[];
  account_types?: AccountType[];
  /** The most telling status across their orders; null when they never ordered. */
  payment_status?: PaymentStatus | null;
  payments?: CustomerPayment[];
};

export type FollowerRow = { user_id: string; name: string | null; email: string | null; phone: string | null; followed_at: string | null };

export type CustomerFilters = {
  /** "any", website account holders, pre-sale buyers, or people who are both. */
  source: "any" | "website" | "presale" | "both";
  verified: "any" | "yes" | "no";
  hasPhone: boolean;
  hasAddress: boolean;
  /** yyyy-mm-dd, inclusive, on the sign-up date. */
  joinedFrom: string;
  joinedTo: string;
  minOrders: number;
  /** "any", "none" (never ordered), or one payment status. */
  payment: "any" | "none" | PaymentStatus;
  accountType: "any" | AccountType;
};

export const NO_FILTERS: CustomerFilters = {
  source: "any",
  verified: "any",
  hasPhone: false,
  hasAddress: false,
  joinedFrom: "",
  joinedTo: "",
  minOrders: 0,
  payment: "any",
  accountType: "any",
};

/** The rows that pass every filter set; an empty filter lets everyone through. */
export function filterCustomers(rows: CustomerRow[], f: CustomerFilters): CustomerRow[] {
  return rows.filter((r) => {
    const website = r.user_id !== null;
    const presale = r.sources.includes("PRESALE");
    if (f.source === "website" && !website) return false;
    if (f.source === "presale" && !presale) return false;
    if (f.source === "both" && !(website && presale)) return false;
    if (f.verified === "yes" && !r.email_verified) return false;
    if (f.verified === "no" && r.email_verified) return false;
    if (f.hasPhone && !r.phone) return false;
    if (f.hasAddress && !r.address) return false;
    const joined = r.joined_at ? r.joined_at.slice(0, 10) : null;
    if (f.joinedFrom && (!joined || joined < f.joinedFrom)) return false;
    if (f.joinedTo && (!joined || joined > f.joinedTo)) return false;
    if (f.minOrders > 0 && r.orders < f.minOrders) return false;
    if (f.payment === "none" && r.payment_status) return false;
    if (f.payment !== "any" && f.payment !== "none" && !(r.payments ?? []).some((p) => p.status === f.payment) && r.payment_status !== f.payment) {
      return false;
    }
    if (f.accountType !== "any" && !(r.account_types ?? []).includes(f.accountType)) return false;
    return true;
  });
}

/**
 * One CSV cell. Quoted when needed; a cell that a spreadsheet would run as a formula (starting with
 * = + - @ or a tab) gets a leading apostrophe, so a name like "=HYPERLINK(...)" stays plain text.
 */
export function csvCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(header: string[], lines: (string | number | boolean | null | undefined)[][]): string {
  // A byte-order mark so Excel opens Bangla names correctly; Windows line endings for Excel too.
  return "﻿" + [header, ...lines].map((line) => line.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/** Amounts as plain numbers in major units ("114.00"), one column per currency seen. */
function major(minor: number): string {
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(minor);
  return `${sign}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

export function customersCsv(rows: CustomerRow[]): string {
  const currencies = [...new Set(rows.flatMap((r) => Object.keys(r.spent)))].sort();
  const header = [
    "Name",
    "Email",
    "Phone",
    "Address",
    "Source",
    "Has account",
    "Email verified",
    "Joined",
    "Orders",
    ...currencies.map((c) => `Spent (${c})`),
    "Last order",
    "Pre-sales",
    "Account type",
    "Artist or band",
    "Payment status",
    "Payments",
  ];
  const lines = rows.map((r) => [
    r.name,
    r.email,
    r.phone,
    r.address,
    r.sources.join(" + "),
    r.user_id ? "Yes" : "No",
    r.email_verified ? "Yes" : "No",
    r.joined_at ? r.joined_at.slice(0, 10) : "",
    r.orders,
    ...currencies.map((c) => (r.spent[c] !== undefined ? major(r.spent[c]) : "")),
    r.last_order_at ? r.last_order_at.slice(0, 10) : "",
    r.presales.map((p) => `${p.product ?? "Product"}: ${p.currency_code} ${major(p.amount_minor)} (${p.status.toLowerCase()})`).join("; "),
    (r.account_types ?? []).map((t) => ACCOUNT_TYPE_LABEL[t] ?? t).join(" + "),
    (r.manages ?? []).join("; "),
    r.payment_status ? PAYMENT_STATUS_LABEL[r.payment_status] : "",
    (r.payments ?? []).map((p) => `${p.at.slice(0, 10)} ${p.currency_code} ${major(p.amount_minor)} ${paymentLine(p)}`).join("; "),
  ]);
  return toCsv(header, lines);
}

export function followersCsv(rows: FollowerRow[]): string {
  return toCsv(
    ["Name", "Email", "Phone", "Followed on"],
    rows.map((r) => [r.name, r.email, r.phone, r.followed_at ? r.followed_at.slice(0, 10) : ""]),
  );
}

/** A safe file name: "corner-room-customers-mizuls-2026-10-27.csv". */
export function csvFileName(parts: (string | null | undefined)[], today: string): string {
  const slug = parts
    .filter(Boolean)
    .join("-")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `corner-room-${slug || "list"}-${today}.csv`;
}
