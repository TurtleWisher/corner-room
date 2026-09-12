export const ANALYTICS_TIMEZONE_NOTE =
  "Daily metrics use the currently assumed Asia/Dhaka metric timezone.";
export const MONEY_TILE_COPY = "Not available in analytics";
export const UNIQUE_LISTENERS_COPY = "Not available";
export const NO_DATA_PERIOD = "No data for this period.";
export const WORKSPACE_REQUIRED_COPY = "Select a workspace";

export function uniqueListenersLabel(value: string): string {
  if (value === "NOT_AVAILABLE") {
    return UNIQUE_LISTENERS_COPY;
  }
  return value;
}

export function moneyTileLabel(status: string): string {
  if (status === "NOT_AVAILABLE") {
    return MONEY_TILE_COPY;
  }
  return status;
}

export function attributionDisplay(status: string): string {
  if (status === "ATTRIBUTION_UNDEFINED") {
    return "ATTRIBUTION_UNDEFINED";
  }
  return status;
}

export function isUnavailableMetric(value: string | number | null | undefined): boolean {
  return value === "NOT_AVAILABLE" || value === "ATTRIBUTION_UNDEFINED";
}

export function countDisplay(value: number, loading: boolean): { skeleton: boolean; text: string | null } {
  if (loading) {
    return { skeleton: true, text: null };
  }
  return { skeleton: false, text: String(value) };
}

export function periodHasCounts(values: number[]): boolean {
  return values.some((value) => value !== 0);
}

export function metricRangeFrom(
  body: { from?: string | null; from_date?: string | null } | null,
): string | null {
  if (!body) {
    return null;
  }
  return body.from ?? body.from_date ?? null;
}

export function analyticsErrorKind(
  code: string | undefined,
  status: number | undefined,
): "workspace" | "range" | "not_found" | "other" {
  if (code === "WORKSPACE_REQUIRED" || status === 409) {
    return "workspace";
  }
  if (code === "INVALID_DATE_RANGE") {
    return "range";
  }
  if (status === 404) {
    return "not_found";
  }
  return "other";
}

export function buildAnalyticsHref(pathname: string, from: string, to: string): string {
  const params = new URLSearchParams();
  if (from) {
    params.set("from", from);
  }
  if (to) {
    params.set("to", to);
  }
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}
