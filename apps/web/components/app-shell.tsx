"use client";

import { AuthProvider } from "@/components/auth-provider";
import { PagePointerLight } from "@/components/brand/pointer-light";
import { ErrorReporter } from "@/components/error-reporter";
import { PlayerBar, PlayerProvider } from "@/components/music/player";
import { NotificationsProvider } from "@/components/notifications-provider";
import { OfflineSync } from "@/components/offline-sync";
import { RoomTransition } from "@/components/shell/room-transition";
import { WorkspaceProvider } from "@/components/workspace-provider";

/**
 * Client providers shared by every route. Since Stage 5 the visible chrome lives in the route-group
 * layouts (app/(public), (listen), (account), (artist), (staff)); /theme-kit sits outside the groups
 * and draws its own full-bleed layout.
 *
 * The player lives here, above every route group (owner, 2026-10-28): moving between pages, Home,
 * Events, your account or Studio, never stops the music. Its bar shows on every page once a song
 * is loaded (hidden inside the full-screen listening room).
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <WorkspaceProvider>
        <NotificationsProvider>
          <PlayerProvider>
            {children}
            <PlayerBar />
            <PagePointerLight />
            <OfflineSync />
            <RoomTransition />
            <ErrorReporter />
          </PlayerProvider>
        </NotificationsProvider>
      </WorkspaceProvider>
    </AuthProvider>
  );
}
