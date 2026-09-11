"use client";

import { Protected } from "@/components/protected";
import { useAuth } from "@/components/auth-provider";
import { Card } from "@/components/ui/card";

function AccountBody() {
  const { user, logout } = useAuth();
  return (
    <Card className="space-y-3">
      <h1 className="text-xl font-semibold">Account</h1>
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <dt>Email</dt>
        <dd>{user?.email}</dd>
        <dt>Name</dt>
        <dd>{user?.display_name}</dd>
        <dt>Status</dt>
        <dd>{user?.status}</dd>
        <dt>Verified</dt>
        <dd>{user?.email_verified ? "yes" : "no"}</dd>
      </dl>
      <button type="button" className="text-sm underline" onClick={() => void logout()}>
        Sign out
      </button>
    </Card>
  );
}

export default function AccountPage() {
  return (
    <Protected>
      <AccountBody />
    </Protected>
  );
}
