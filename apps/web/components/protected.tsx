"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { ErrorState, LoadingState } from "@/components/async-state";
import { useAuth } from "@/components/auth-provider";
import { resolveProtectedView } from "@/lib/auth-view";

export function Protected({
  children,
  permission,
}: {
  children: React.ReactNode;
  permission?: string;
}) {
  const { status, user } = useAuth();
  const pathname = usePathname();
  const view = resolveProtectedView(status, user, permission);

  if (view.kind === "loading") {
    return <LoadingState label="Checking session" />;
  }
  if (view.kind === "unauthenticated") {
    return (
      <div className="space-y-3">
        <ErrorState
          title={view.reason === "expired" ? "Session expired" : "Sign in required"}
          message="This page is protected. Sign in to continue."
        />
        <p className="text-sm">
          <Link href="/login" className="underline">
            Sign in
          </Link>
        </p>
      </div>
    );
  }
  if (view.kind === "forbidden") {
    return (
      <ErrorState
        title="Not permitted"
        message="You are signed in but do not have permission to view this page."
      />
    );
  }
  return (
    <div>
      {pathname === "/account" ? null : (
        <p className="mb-4 text-sm">
          <Link href="/account" className="underline">
            Account
          </Link>
        </p>
      )}
      {children}
    </div>
  );
}
