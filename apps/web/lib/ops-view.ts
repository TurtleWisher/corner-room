export const EMAIL_STUB_COPY = "EMAIL STUB";
export const UNIQUE_LISTENERS_COPY = "Not available";
export const MONEY_NOT_AVAILABLE_COPY = "Not available";
export const WORKSPACE_REQUIRED_COPY = "Select a workspace";

export function healthLabel(status: string | undefined): string {
  return status || "UNKNOWN";
}

export function checkLabel(check: { status?: string; honesty?: string } | boolean | undefined): string {
  if (check === undefined) {
    return "UNKNOWN";
  }
  if (typeof check === "boolean") {
    return check ? "HEALTHY" : "UNAVAILABLE";
  }
  if (check.honesty) {
    return `${check.status ?? "UNKNOWN"} · ${check.honesty}`;
  }
  return check.status ?? "UNKNOWN";
}

export function opsErrorKind(code?: string, status?: number): "workspace" | "forbidden" | "not_found" | "other" {
  if (code === "WORKSPACE_REQUIRED" || status === 409) {
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
