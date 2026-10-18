/*
 * Pure helpers for joining Corner Room as an artist or as staff. The API decides every status and
 * permission; these only turn its answers into words and links.
 */

export type ApplicationLike = { status: string; artist_status?: string | null };

/** Where an artist application stands, in the applicant's words, and what happens next. */
export function applicationStage(app: ApplicationLike): { title: string; body: string; tone: "progress" | "good" | "attention" } {
  if (app.status === "APPROVED" && app.artist_status === "ACTIVE") {
    return { title: "You're in", body: "Your artist profile is active. Open Studio to make your first release.", tone: "good" };
  }
  if (app.status === "APPROVED") {
    return { title: "Approved", body: "The label team approved you. Your profile goes live when they finish setting it up.", tone: "progress" };
  }
  if (app.status === "UNDER_REVIEW") return { title: "Being reviewed", body: "The label team is looking at your application.", tone: "progress" };
  if (app.status === "REJECTED") return { title: "Not accepted this time", body: "The label team did not accept this application.", tone: "attention" };
  if (app.status === "WITHDRAWN") return { title: "Withdrawn", body: "You withdrew this application.", tone: "attention" };
  return { title: "Sent", body: "The label team will review it. You can keep listening meanwhile.", tone: "progress" };
}

/** A new application is only offered when none is still open. */
export function canApplyAgain(apps: ApplicationLike[]): boolean {
  return apps.every((a) => a.status === "REJECTED" || a.status === "WITHDRAWN");
}

/** The link a staff invitee opens (their own join page); the token is only in the link. */
export function inviteLink(origin: string, token: string): string {
  return `${origin.replace(/\/$/, "")}/staff/join?invite=${encodeURIComponent(token)}`;
}

/** A label's artist join link (owner, 2026-10-17: one shared link, staff still review). */
export function artistJoinLink(origin: string, code: string): string {
  return `${origin.replace(/\/$/, "")}/studio/join?code=${encodeURIComponent(code)}`;
}

/** What staff see about a join link's state. */
export function joinLinkState(link: { status: string; usable: boolean; max_uses: number | null; uses: number; expires_at: string | null }, now = Date.now()): string {
  if (link.status !== "ACTIVE") return "Switched off";
  if (link.max_uses !== null && link.uses >= link.max_uses) return "Full";
  if (link.expires_at && Date.parse(link.expires_at) <= now) return "Ended";
  return "Active";
}

/** How a member is named on the workspace page: name and email for admins, otherwise a short id. */
export function memberLabel(m: { user_id: string; display_name?: string | null; email?: string | null }): { primary: string; secondary: string | null } {
  if (m.display_name || m.email) return { primary: m.display_name || m.email || "", secondary: m.display_name ? (m.email ?? null) : null };
  return { primary: `Member ${m.user_id.slice(0, 8)}`, secondary: null };
}

/** Staff actions on an application, offered in order; the API refuses any that do not apply. */
export function applicationActions(app: ApplicationLike): { action: string; label: string; target: "application" | "artist"; danger?: boolean }[] {
  if (app.status === "SUBMITTED") return [{ action: "start_review", label: "Start review", target: "application" }];
  if (app.status === "UNDER_REVIEW") {
    return [
      { action: "approve", label: "Approve", target: "application" },
      { action: "reject", label: "Reject", target: "application", danger: true },
    ];
  }
  if (app.status === "APPROVED" && app.artist_status !== "ACTIVE") return [{ action: "activate", label: "Activate the artist", target: "artist" }];
  return [];
}
