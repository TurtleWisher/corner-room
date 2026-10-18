export type AuthStatus = "loading" | "anonymous" | "authenticated" | "expired";

export type ProtectedView =
  | { kind: "loading" }
  | { kind: "unauthenticated"; reason: "anonymous" | "expired" }
  | { kind: "forbidden" }
  /** Signed in, but not staff (no workspace, no staff permissions): a fan or an artist. */
  | { kind: "not_staff" }
  | { kind: "ok" };

export function resolveProtectedView(
  status: AuthStatus,
  user: { permissions?: string[]; has_workspace?: boolean } | null,
  permission?: string,
): ProtectedView {
  if (status === "loading") {
    return { kind: "loading" };
  }
  if (status === "anonymous" || status === "expired" || !user) {
    return { kind: "unauthenticated", reason: status === "expired" ? "expired" : "anonymous" };
  }
  // The console is for staff: someone in a workspace or holding staff permissions. A fan or an
  // artist sees "staff only" instead of an empty console (the API refuses them everything anyway).
  if (!user.has_workspace && (user.permissions ?? []).length === 0) {
    return { kind: "not_staff" };
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

/**
 * Where to go after signing in. Only same-site paths are accepted ("/checkout?offer=1"), so a
 * crafted link cannot send someone to another site (no "//host", no scheme, no backslashes).
 */
export function safeNextPath(next: string | null | undefined, fallback = "/account"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\") || /^\/[^/]*:/.test(next)) {
    return fallback;
  }
  return next;
}

/**
 * Carry where someone was going through sign-up and verification: "/login?next=%2Fartists%2Fapply".
 * An unsafe or missing destination is simply left off. A "#fragment" in `path` stays at the end.
 */
export function withNext(path: string, next: string | null | undefined): string {
  const safe = next ? safeNextPath(next, "") : "";
  if (!safe) return path;
  const hash = path.indexOf("#");
  const base = hash < 0 ? path : path.slice(0, hash);
  const fragment = hash < 0 ? "" : path.slice(hash);
  return `${base}${base.includes("?") ? "&" : "?"}next=${encodeURIComponent(safe)}${fragment}`;
}

/** The sign-in pages: fans, artists and staff use the same accounts, each on their own page. */
export const SIGN_IN_PAGES = ["/login", "/studio/sign-in", "/staff/sign-in"] as const;

/** Only a known sign-in page; anything else is the fan one. */
export function signInPageFrom(value: string | null | undefined): string {
  return (SIGN_IN_PAGES as readonly string[]).includes(value ?? "") ? (value as string) : "/login";
}

/** The verification link, telling it where to sign in afterwards and where to go after that. */
export function verifyLinkFor(verifyPath: string, next: string | null | undefined, signInPath: string): string {
  const withDest = withNext(verifyPath, next);
  if (signInPath === "/login") return withDest;
  const hash = withDest.indexOf("#");
  const base = hash < 0 ? withDest : withDest.slice(0, hash);
  const fragment = hash < 0 ? "" : withDest.slice(hash);
  return `${base}${base.includes("?") ? "&" : "?"}signin=${encodeURIComponent(signInPageFrom(signInPath))}${fragment}`;
}

