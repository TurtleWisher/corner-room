"use client";

import { AuthProvider } from "@/components/auth-provider";
import { PagePointerLight } from "@/components/brand/pointer-light";
import { NotificationsProvider } from "@/components/notifications-provider";
import { WorkspaceProvider } from "@/components/workspace-provider";

/**
 * Client providers shared by every route. Since Stage 5 the visible chrome lives in the route-group
 * layouts (app/(public), (listen), (account), (artist), (staff)); /theme-kit sits outside the groups
 * and draws its own full-bleed layout.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <WorkspaceProvider>
        <NotificationsProvider>
          {children}
          <PagePointerLight />
        </NotificationsProvider>
      </WorkspaceProvider>
    </AuthProvider>
  );
}
