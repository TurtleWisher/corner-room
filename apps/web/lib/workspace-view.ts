import type { Membership } from "@/lib/api";

/** Drop collections that do not belong to the active organization. UI is not authz. */
export function membersForActiveOrg(
  currentOrgId: string | null,
  membersOrgId: string | null,
  members: Membership[],
): Membership[] {
  if (!currentOrgId || currentOrgId !== membersOrgId) {
    return [];
  }
  return members;
}

export function invitationsForActiveOrg<T extends { organization_id: string }>(
  currentOrgId: string | null,
  rows: T[],
): T[] {
  return rowsForActiveOrg(currentOrgId, rows);
}

export function rowsForActiveOrg<T extends { organization_id?: string; primary_org_id?: string | null }>(
  currentOrgId: string | null,
  rows: T[],
): T[] {
  if (!currentOrgId) {
    return [];
  }
  return rows.filter((row) => (row.organization_id ?? row.primary_org_id) === currentOrgId);
}
