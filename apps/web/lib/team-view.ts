/* Who runs an artist profile (owner, 2026-10-30, D-ARTIST-UNIFY-01): view helpers only. The API
 * decides who may do what; these only order the list and word it. */

export type TeamRole = "OWNER" | "MANAGER";

export type TeamMember = {
  id: string;
  user_id: string;
  display_name: string | null;
  email: string | null;
  role: TeamRole;
  status: string;
  requested_at: string;
  reviewed_at: string | null;
};

export type Team = {
  profile: { kind: "artist" | "band"; id: string; display_name: string };
  my_role: TeamRole | null;
  can_pick_managers: boolean;
  members: TeamMember[];
};

export type TeamRequest = TeamMember & {
  profile: { kind: "artist" | "band"; id: string; display_name: string };
  picked_by: string | null;
};

/** Owner first, then approved managers, then picks waiting for staff; oldest first within each. */
export function orderTeam(members: readonly TeamMember[]): TeamMember[] {
  const rank = (m: TeamMember) => (m.role === "OWNER" ? 0 : m.status === "ACTIVE" ? 1 : 2);
  return [...members].sort((a, b) => rank(a) - rank(b) || a.requested_at.localeCompare(b.requested_at));
}

export function memberName(m: Pick<TeamMember, "display_name" | "email">): string {
  return m.display_name?.trim() || m.email || "Corner Room account";
}

/** The plain-words badge beside a person. */
export function memberBadge(m: Pick<TeamMember, "role" | "status">): string {
  if (m.role === "OWNER") return "Owner";
  return m.status === "PENDING" ? "Waiting for staff approval" : "Manager";
}

/**
 * Which button a row gets for the person looking: the owner takes managers off and withdraws
 * picks; a manager can leave. Nobody takes the owner off here (staff change the owner).
 */
export function takeOffAction(m: Pick<TeamMember, "role" | "status" | "user_id">, team: Pick<Team, "my_role">, myUserId: string | null): "remove" | "withdraw" | "leave" | null {
  if (m.role === "OWNER") return null;
  if (team.my_role === "OWNER") return m.status === "PENDING" ? "withdraw" : "remove";
  if (myUserId !== null && m.user_id === myUserId && m.status === "ACTIVE") return "leave";
  return null;
}

/** The owner can hand the profile to a manager staff have approved (owner, 2026-10-31). */
export function canHandOver(m: Pick<TeamMember, "role" | "status">, team: Pick<Team, "my_role">): boolean {
  return team.my_role === "OWNER" && m.role === "MANAGER" && m.status === "ACTIVE";
}

export const TAKE_OFF_LABEL = { remove: "Remove", withdraw: "Withdraw", leave: "Leave this team" } as const;
