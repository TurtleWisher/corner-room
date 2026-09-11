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
};

const AuthContext = createContext<AuthContextValue | null>(null);

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
        await apiLogout();
        setUser(null);
        setStatus("anonymous");
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
