"use client";

/*
 * Staff sign-in (owner, 2026-10-17: staff and admins sign in on their own page). Same Corner Room
 * account; it opens the staff console afterwards. Staff accounts come only from an invitation
 * link (/staff/join?invite=...), so this page offers no sign-up.
 */

import { SignInForm } from "@/components/account/sign-in-form";

export default function StaffSignInPage() {
  return (
    <SignInForm
      title="Staff sign-in"
      intro="Sign in to the Corner Room staff console."
      defaultNext="/staff"
      google={false}
      theme="staff"
      footer={() => <>Staff accounts are by invitation. Ask your administrator for an invitation link.</>}
    />
  );
}
