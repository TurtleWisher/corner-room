"use client";

/*
 * In-app offline housekeeping (D-AUDIO-18), mounted once in the app shell:
 * - registers the service worker (production builds only) that opens /offline.html when there is
 *   no connection;
 * - marks which account's saved songs /offline.html shows;
 * - once per visit while signed in and online, asks the API about each saved song and removes the
 *   copies this account may no longer have (refunded, legal takedown, gone; lib/offline-view.ts).
 */

import { useEffect, useRef } from "react";

import { useAuth } from "@/components/auth-provider";
import { fetchDownloadOptions } from "@/features/downloads/api";
import { ApiError } from "@/lib/api/client";
import { listOfflineSongs, offlineSupported, removeOfflineSong, setOfflineOwner } from "@/lib/offline-store";
import { belongsTo, shouldForget } from "@/lib/offline-view";

export function OfflineSync() {
  const { status, user } = useAuth();
  const checked = useRef<string | null>(null);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }, []);

  useEffect(() => {
    if (status !== "authenticated" || !user || !offlineSupported()) return;
    setOfflineOwner(user.id);
    if (checked.current === user.id || (typeof navigator !== "undefined" && navigator.onLine === false)) return;
    checked.current = user.id;
    void (async () => {
      let songs;
      try {
        songs = belongsTo(await listOfflineSongs(), user.id);
      } catch {
        return;
      }
      for (const song of songs) {
        try {
          await fetchDownloadOptions(song.trackId);
        } catch (err) {
          if (err instanceof ApiError && shouldForget(err.status, err.code)) {
            await removeOfflineSong(song.trackId).catch(() => undefined);
          }
        }
      }
    })();
  }, [status, user]);

  return null;
}
