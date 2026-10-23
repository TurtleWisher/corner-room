"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import {
  ApiError,
  clearAccessToken,
  fetchMe,
  getAccessToken,
  login as apiLogin,
  logout as apiLogout,
  restoreSession,
  subscribeAccessToken,
  type AuthUser,
} from "@/lib/api";

type AuthStatus = "loading" | "anonymous" | "authenticated" | "expired";

type AuthContextValue = {
  status: AuthStatus;
  user: AuthUser | null;
  error: string | null;
  login: (email: string, password: string) => Promise<AuthUser>;
  logout: () => Promise<void>;
  /** Re-read /me after something changed who the user is (joined a workspace, became an artist). */
  refreshUser: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

const AUTH_CHANNEL = "cr-auth";
const SIGNED_OUT = "signed-out";

/** Tell this browser's other tabs that the account signed out, so they stop showing it. */
function announceSignedOut() {
  if (typeof BroadcastChannel === "undefined") {
    return;
  }
  const channel = new BroadcastChannel(AUTH_CHANNEL);
  channel.postMessage(SIGNED_OUT);
  channel.close();
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const restored = await restoreSession();
      if (cancelled) {
        return;
      }
      if (restored) {
        setUser(restored);
        setStatus("authenticated");
      } else {
        setUser(null);
        setStatus("anonymous");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // A page brought back from the browser's back/forward cache still holds the old sign-in in
  // memory, and other tabs don't see a sign-out: hide the account at once and ask the API again.
  useEffect(() => {
    const recheck = async () => {
      clearAccessToken();
      setUser(null);
      setStatus("loading");
      const restored = await restoreSession();
      setUser(restored);
      setStatus(restored ? "authenticated" : "anonymous");
    };
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        void recheck();
      }
    };
    window.addEventListener("pageshow", onPageShow);
    const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(AUTH_CHANNEL);
    if (channel) {
      channel.onmessage = (event: MessageEvent) => {
        if (event.data === SIGNED_OUT) {
          clearAccessToken();
          setUser(null);
          setStatus("anonymous");
        }
      };
    }
    return () => {
      window.removeEventListener("pageshow", onPageShow);
      channel?.close();
    };
  }, []);

  useEffect(() => {
    return subscribeAccessToken((token) => {
      if (!token && status === "authenticated") {
        setUser(null);
        setStatus("expired");
      }
    });
  }, [status]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      error,
      async login(email: string, password: string) {
        setError(null);
        try {
          const result = await apiLogin(email, password);
          const me = await fetchMe();
          setUser(me);
          setStatus("authenticated");
          return me;
        } catch (err) {
          clearAccessToken();
          setUser(null);
          setStatus("anonymous");
          const message = err instanceof ApiError ? err.message : "Sign in failed";
          setError(message);
          throw err;
        }
      },
      async logout() {
        try {
          await apiLogout();
        } finally {
          setUser(null);
          setStatus("anonymous");
          announceSignedOut();
        }
      },
      async refreshUser() {
        try {
          setUser(await fetchMe());
        } catch {
          /* keep what we have; the next page load reads /me again */
        }
      },
    }),
    [error, status, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}

export function getStoredAccessToken(): string | null {
  return getAccessToken();
}
