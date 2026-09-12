"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";

import { useAuth } from "@/components/auth-provider";
import { ApiError, fetchMyNotifications, markNotificationRead, type NotificationRecord } from "@/lib/api";
import { applyOptimisticRead, parseNotificationList } from "@/lib/notifications-view";

type NotificationsContextValue = {
  items: NotificationRecord[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
};

const NotificationsContext = createContext<NotificationsContextValue | null>(null);

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const pathname = usePathname();
  const [items, setItems] = useState<NotificationRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (status !== "authenticated") {
      setItems([]);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const body = await fetchMyNotifications();
      setItems(parseNotificationList(body));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Unable to load notifications");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    void reload();
  }, [reload, pathname]);

  const markRead = useCallback(
    async (id: string) => {
      const previous = items;
      setItems(applyOptimisticRead(items, id, new Date().toISOString()));
      try {
        const updated = await markNotificationRead(id);
        setItems((current) => current.map((row) => (row.id === id ? updated : row)));
      } catch (err) {
        setItems(previous);
        throw err;
      }
    },
    [items],
  );

  const value = useMemo(
    () => ({ items, loading, error, reload, markRead }),
    [items, loading, error, reload, markRead],
  );

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

export function useNotifications(): NotificationsContextValue {
  const ctx = useContext(NotificationsContext);
  if (!ctx) {
    throw new Error("useNotifications must be used within NotificationsProvider");
  }
  return ctx;
}
