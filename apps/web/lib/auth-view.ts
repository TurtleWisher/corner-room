export type AuthStatus = "loading" | "anonymous" | "authenticated" | "expired";

export type ProtectedView =
  | { kind: "loading" }
  | { kind: "unauthenticated"; reason: "anonymous" | "expired" }
  | { kind: "forbidden" }
  | { kind: "ok" };

export function resolveProtectedView(
  status: AuthStatus,
  user: { permissions?: string[] } | null,
  permission?: string,
): ProtectedView {
  if (status === "loading") {
    return { kind: "loading" };
  }
  if (status === "anonymous" || status === "expired" || !user) {
    return { kind: "unauthenticated", reason: status === "expired" ? "expired" : "anonymous" };
  }
  if (permission && !(user.permissions ?? []).includes(permission)) {
    return { kind: "forbidden" };
  }
  return { kind: "ok" };
}

export function loginFormState(submitting: boolean, error: string | null): "idle" | "loading" | "error" {
  if (submitting) {
    return "loading";
  }
  if (error) {
    return "error";
  }
  return "idle";
}

/** UX-only nav flags. Authorization remains on the API. */
export function staffNavFlags(permissions: string[] | undefined): {
  showAnalytics: boolean;
  showFinance: boolean;
  showOps: boolean;
  showUsers: boolean;
  showOrgs: boolean;
} {
  const perms = permissions ?? [];
  return {
    showAnalytics: perms.includes("analytics.read"),
    showFinance: perms.includes("finance.read"),
    showOps: perms.includes("audit.read"),
    showUsers: perms.includes("user.admin"),
    showOrgs: perms.includes("org.admin"),
  };
}
