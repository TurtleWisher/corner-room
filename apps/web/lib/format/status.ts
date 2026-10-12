/**
 * Status labels: API enum value -> human copy + tone. Maps are filled per module from the
 * API's real enums (Stages 6 to 12). Unknown values never break: they are humanised and shown
 * with a neutral tone. The UI never hard-codes transitions (CORNER_ROOM_PROJECT_CONTEXT section 8).
 */
export type StatusTone = "neutral" | "positive" | "warning" | "negative" | "info" | "accent";

export interface StatusEntry {
  label: string;
  tone: StatusTone;
}

export type StatusMap = Readonly<Record<string, StatusEntry>>;

export function defineStatusMap<T extends Record<string, StatusEntry>>(map: T): Readonly<T> {
  return Object.freeze({ ...map });
}

/** "AWAITING_SECOND_APPROVAL" -> "Awaiting second approval" */
export function humanizeStatus(value: string): string {
  const words = value.trim().replace(/[_\-.]+/g, " ").replace(/\s+/g, " ").toLowerCase();
  return words ? words[0].toUpperCase() + words.slice(1) : "";
}

export function resolveStatus(map: StatusMap | undefined, value: string | null | undefined): StatusEntry | null {
  if (value === null || value === undefined || value.trim() === "") return null;
  const hit = map?.[value] ?? map?.[value.toUpperCase()];
  return hit ?? { label: humanizeStatus(value), tone: "neutral" };
}
