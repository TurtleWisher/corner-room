/*
 * Songs saved for offline listening inside Corner Room (owner, 2026-10-25, D-AUDIO-18: in-app
 * offline instead of file downloads). Each bought song's MP3 320 copy, checked against the API's
 * SHA-256, is kept in this browser's IndexedDB with its cover, and plays without a connection on
 * /offline.html (public/offline-player.js reads the same database: keep DB_NAME, DB_VERSION and
 * STORE in step with it). The API still decides who may save: the copy comes from the buyer-only
 * download endpoint, and OfflineSync removes copies the API no longer lets this account have.
 */

export const DB_NAME = "cornerroom-offline";
export const DB_VERSION = 1;
export const STORE = "songs";

export type OfflineSong = {
  trackId: string;
  title: string;
  /** Releases the track was known to be on when saved (ownership through a release). */
  releaseIds: string[];
  audio: Blob;
  mime: string;
  byteSize: number;
  sha256: string;
  cover: Blob | null;
  /** The account that saved it; copies of other accounts are hidden and cleaned up. */
  userId: string;
  savedAt: string;
};

export type OfflineSongSummary = Omit<OfflineSong, "audio" | "cover">;

export function offlineSupported(): boolean {
  return typeof indexedDB !== "undefined";
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "trackId" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = work(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error ?? req.error);
      tx.onabort = () => reject(tx.error ?? new Error("aborted"));
    });
  } finally {
    db.close();
  }
}

export async function saveOfflineSong(song: OfflineSong): Promise<void> {
  await run("readwrite", (s) => s.put(song));
}

export async function getOfflineSong(trackId: string): Promise<OfflineSong | null> {
  return ((await run("readonly", (s) => s.get(trackId))) as OfflineSong | undefined) ?? null;
}

export async function listOfflineSongs(): Promise<OfflineSong[]> {
  return (await run("readonly", (s) => s.getAll())) as OfflineSong[];
}

export async function removeOfflineSong(trackId: string): Promise<void> {
  await run("readwrite", (s) => s.delete(trackId));
}

/*
 * Whose songs /offline.html shows. Set while an account is signed in here, cleared on sign out, so
 * the next person on a shared browser sees nothing (the copies stay until that account signs in
 * again or removes them). public/offline-player.js reads the same key.
 */
export const OWNER_KEY = "cr-offline-owner";

export function setOfflineOwner(userId: string): void {
  try {
    localStorage.setItem(OWNER_KEY, userId);
  } catch {
    // Private mode or blocked storage: offline songs simply won't show.
  }
}

export function clearOfflineOwner(): void {
  try {
    localStorage.removeItem(OWNER_KEY);
  } catch {
    // Nothing to clear.
  }
}

/** Ask the browser not to clear saved songs under storage pressure (best effort). */
export async function askToKeepStorage(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
