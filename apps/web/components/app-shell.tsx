"use client";

import Link from "next/link";

import { AuthProvider, useAuth } from "@/components/auth-provider";
import { WorkspaceProvider } from "@/components/workspace-provider";

function NavAuth() {
  const { status, user, logout } = useAuth();
  if (status === "authenticated" && user) {
    return (
      <nav className="flex items-center gap-4 text-sm text-neutral-600">
        <Link href="/organizations">Organizations</Link>
        <Link href="/events">Events</Link>
        <Link href="/venues">Venues</Link>
        <Link href="/artists">Artists</Link>
        <Link href="/bands">Bands</Link>
        <Link href="/releases">Releases</Link>
        <Link href="/tracks">Tracks</Link>
        <Link href="/listen">Listen</Link>
        <Link href="/store">Store</Link>
        <Link href="/purchases">Purchases</Link>
        <Link href="/subscriptions">Subscriptions</Link>
        <Link href="/library">Library</Link>
        <Link href="/playlists">Playlists</Link>
        <Link href="/history">History</Link>
        <Link href="/tickets">Tickets</Link>
        <Link href="/orders">Orders</Link>
        <Link href="/staff/commerce">Commerce</Link>
        <Link href="/royalties">Royalties</Link>
        <Link href="/staff/royalties">Royalty ops</Link>
        <Link href="/staff/finance">Finance</Link>
        <Link href="/account">Account</Link>
        <button type="button" className="underline" onClick={() => void logout()}>
          Sign out
        </button>
      </nav>
    );
  }
  return (
    <nav className="flex gap-4 text-sm text-neutral-600">
      <Link href="/discover">Events</Link>
      <Link href="/artists">Artists</Link>
      <Link href="/releases">Releases</Link>
      <Link href="/tracks">Tracks</Link>
        <Link href="/listen">Listen</Link>
        <Link href="/store">Store</Link>
        <Link href="/login">Sign in</Link>
      <Link href="/register">Register</Link>
    </nav>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <WorkspaceProvider>
        <header className="border-b border-neutral-200">
          <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
            <Link href="/" className="font-semibold">
              Corner Room
            </Link>
            <NavAuth />
          </div>
        </header>
        <main className="mx-auto max-w-3xl px-6 py-10">{children}</main>
      </WorkspaceProvider>
    </AuthProvider>
  );
}
