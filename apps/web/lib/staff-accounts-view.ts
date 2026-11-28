/*
 * Staff accounts in words (owner, 2026-11-28, D-STAFF-ACCOUNTS-01). Admins add staff by email; the
 * person signs in with Continue with Google using that address (or a password: it is one account),
 * and a fan account with that email simply becomes their staff account too. Only the owner adds or
 * removes admins. The API decides every one of these rules; these words only explain them.
 */

import type { StaffAccount, StaffArea, StaffInvite, StaffLevel } from "@/features/staff-portal/api";

export const LEVEL_WORDS: Record<StaffLevel, { label: string; does: string }> = {
  OWNER: { label: "Owner", does: "Runs Corner Room. Adds and removes admins." },
  ADMIN: { label: "Admin", does: "Sees and runs every part of the staff portal, and adds staff." },
  STAFF: { label: "Staff", does: "Works only in the areas picked for them." },
};

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function emailProblem(text: string): string | null {
  const value = text.trim();
  if (!value) return "Type their email address.";
  if (!EMAIL.test(value)) return "Type a full email address, like name@gmail.com.";
  return null;
}

export function addProblem(input: { email: string; level: "ADMIN" | "STAFF" | null; areas: string[] }): string | null {
  const email = emailProblem(input.email);
  if (email) return email;
  if (!input.level) return "Choose Admin or Staff.";
  if (input.level === "STAFF" && input.areas.length === 0) return "Pick at least one area.";
  return null;
}

export function areaLabels(keys: string[], areas: StaffArea[]): string[] {
  const byKey = new Map(areas.map((a) => [a.key, a.label]));
  return keys.map((k) => byKey.get(k) ?? k);
}

/** Areas grouped for the picker, in the API's order. */
export function groupAreas(areas: StaffArea[]): { group: string; areas: StaffArea[] }[] {
  const out: { group: string; areas: StaffArea[] }[] = [];
  for (const area of areas) {
    const found = out.find((g) => g.group === area.group);
    if (found) found.areas.push(area);
    else out.push({ group: area.group, areas: [area] });
  }
  return out;
}

export function toggle(keys: string[], key: string): string[] {
  return keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key];
}

/** "Just now", "12 min ago", "3 h ago", "Yesterday", "5 days ago", "Never". */
export function agoWords(iso: string | null, now: Date = new Date()): string {
  if (!iso) return "No actions yet";
  const ms = now.getTime() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "No actions yet";
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "Just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return "Yesterday";
  return `${d} days ago`;
}

export function addedWords(state: "ADDED" | "WAITING", email: string): string {
  return state === "ADDED"
    ? `${email} is on the staff now. Their account already existed, so they can open the staff portal straight away.`
    : `${email} is invited. When they sign in with Continue with Google using this address, their staff account is ready. We sent them an email saying so.`;
}

export const REFUSALS: Record<string, string> = {
  OWNER_ONLY: "Only the owner can add, change or remove admins.",
  NOT_YOURSELF: "You can't change your own staff account. Ask another admin or the owner.",
  OWNER_FIXED: "The owner's account can't be changed here.",
  NO_AREAS: "Pick at least one area.",
  BAD_EMAIL: "Type a full email address, like name@gmail.com.",
  ACCOUNT_NOT_ACTIVE: "That account is suspended or closed. Reactivate it in Users first.",
  NOT_STAFF: "This person isn't on the staff any more.",
  NOT_ALLOWED: "Only admins can manage staff accounts.",
};

export type AccountFilter = "all" | StaffLevel | "waiting";

export function filterAccounts(accounts: StaffAccount[], filter: AccountFilter, query: string, areas: StaffArea[]): StaffAccount[] {
  const q = query.trim().toLowerCase();
  return accounts.filter((a) => {
    if (filter !== "all" && filter !== "waiting" && a.level !== filter) return false;
    if (!q) return true;
    const hay = [a.name, a.email ?? "", LEVEL_WORDS[a.level].label, ...areaLabels(a.areas, areas)].join(" ").toLowerCase();
    return hay.includes(q);
  });
}

export function filterInvites(invites: StaffInvite[], query: string): StaffInvite[] {
  const q = query.trim().toLowerCase();
  return q ? invites.filter((i) => i.email.includes(q)) : invites;
}

export function levelCounts(accounts: StaffAccount[], invites: StaffInvite[]): Record<AccountFilter, number> {
  const count = (level: StaffLevel) => accounts.filter((a) => a.level === level).length;
  return { all: accounts.length, OWNER: count("OWNER"), ADMIN: count("ADMIN"), STAFF: count("STAFF"), waiting: invites.length };
}
