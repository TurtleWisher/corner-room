/*
 * The way into and out of the listening room (owner, 2026-10-31): a short, quiet cross-fade between
 * pages, with the cover in the player bar growing into the room's front card, like a music app's
 * "now playing". Pure decisions only; components/shell/room-transition.tsx runs them.
 */

/** The full-screen listening room, `/listen/{trackId}` (the Listen tab itself is `/listen`). */
export function isListeningRoom(pathname: string | null | undefined): boolean {
  return Boolean(pathname && /^\/listen\/[^/?#]+$/.test(pathname));
}

/** Only a move into or out of the room gets the transition; every other page change stays instant. */
export function wantsRoomTransition(from: string | null | undefined, to: string | null | undefined): boolean {
  if (!from || !to || from === to) return false;
  return isListeningRoom(from) || isListeningRoom(to);
}

export type LinkClick = {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  defaultPrevented: boolean;
  target: string | null;
  download: boolean;
  href: string | null;
};

/**
 * The in-app path a plain click on this link opens, or null when the browser should handle it as it
 * would anyway (new tab, download, another site, a modifier key, or a page that already handled it).
 */
export function inAppPath(click: LinkClick, origin: string): string | null {
  if (click.defaultPrevented || click.button !== 0) return null;
  if (click.metaKey || click.ctrlKey || click.shiftKey || click.altKey) return null;
  if (click.download || (click.target && click.target !== "_self") || !click.href) return null;
  let url: URL;
  try {
    url = new URL(click.href, origin);
  } catch {
    return null;
  }
  if (url.origin !== origin) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}
