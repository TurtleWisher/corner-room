/* Pure rules for in-app offline songs (D-AUDIO-18). Display and housekeeping only; the API decides access. */

/**
 * API answers to "may this account still have this song?" that mean the saved copy must go:
 * not bought (or refunded, D-AUDIO-06), removed for a legal reason (D-AUDIO-14) or gone. Anything
 * else (offline, server trouble, rate limits) keeps the copy.
 */
export const FORGET_CODES = new Set(["DOWNLOAD_NOT_OWNED", "TRACK_TAKEN_DOWN", "NOT_FOUND", "TRACK_NOT_RELEASED"]);

export function shouldForget(status: number, code: string | null): boolean {
  if (status === 404) return true;
  return code !== null && FORGET_CODES.has(code);
}

/** Saved songs belong to the account that saved them; other accounts on the same browser can't see them. */
export function belongsTo<T extends { userId: string }>(songs: T[], userId: string | null | undefined): T[] {
  return userId ? songs.filter((s) => s.userId === userId) : [];
}
