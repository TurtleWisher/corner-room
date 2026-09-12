export const WORKSPACE_REQUIRED_COPY = "Select a workspace";

export function userStatusLabel(status: string): string {
  return status;
}

export function adminErrorKind(code?: string, status?: number): "workspace" | "forbidden" | "not_found" | "other" {
  if (code === "WORKSPACE_REQUIRED") {
    return "workspace";
  }
  if (status === 403) {
    return "forbidden";
  }
  if (status === 404) {
    return "not_found";
  }
  return "other";
}

export function canUnsuspend(status: string): boolean {
  return status === "SUSPENDED";
}

export function canSuspend(status: string): boolean {
  return status === "ACTIVE";
}
