/* Fan view (owner, 2026-10-24: "Artist and staff can also enjoy corner room by switching to their
 * fan role"). One account does everything; fan view only hides the "Staff tools" boxes on fan pages
 * so they look as fans see them. Remembered on this device. UX only: it changes no permission, and
 * the API still decides everything. Opening Studio or the staff console turns it off again. */

export const FAN_VIEW_KEY = "cr-fan-view";
/** Fired in this tab when fan view changes (other tabs get the storage event). */
export const FAN_VIEW_EVENT = "cr-fan-view";
/** Where "Switch to fan view" goes: the home page's welcome section (D-NAV-01). */
export const FAN_VIEW_HOME = "/#welcome";

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** Whether fan view is on; any storage problem reads as off. */
export function readFanView(store: Store | null | undefined): boolean {
  try {
    return store?.getItem(FAN_VIEW_KEY) === "1";
  } catch {
    return false;
  }
}

/** Turn fan view on or off; storage that is blocked is simply skipped. */
export function writeFanView(store: Store | null | undefined, on: boolean): void {
  try {
    if (on) store?.setItem(FAN_VIEW_KEY, "1");
    else store?.removeItem(FAN_VIEW_KEY);
  } catch {
    // Private windows and blocked storage: fan view just isn't remembered.
  }
}
