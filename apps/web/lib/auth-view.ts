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
