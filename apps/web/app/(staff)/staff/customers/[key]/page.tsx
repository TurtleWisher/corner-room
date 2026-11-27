"use client";

/*
 * One person's page for staff (owner, 2026-11-27, D-CUSTOMERS-03): opened from Customers and users.
 * Who they are and how to reach them, what they spent and own, and their whole story: every order
 * with each payment they sent and how staff decided it, refunds, music, listening, follows, gifts,
 * emails from acts, sign-ins and their own account actions, newest first. The server counts and
 * adds up every number and records that this page was opened; nothing here changes anything.
 */

import { useParams } from "next/navigation";

import { CustomerProfileView } from "@/components/staff/customer-profile";
import { ErrorState, LoadingState, Protected } from "@/components/staff/kit";
import { useAsync } from "@/components/use-async";
import { fetchCustomerProfile } from "@/features/commerce/api";
import { ApiError } from "@/lib/api/client";

function Profile() {
  const params = useParams<{ key: string }>();
  const key = decodeURIComponent(params.key ?? "");
  const page = useAsync(() => fetchCustomerProfile(key), [key]);
  if (page.status === "loading") return <LoadingState label="Loading this person" />;
  if (page.status === "error") {
    const notFound = page.error instanceof ApiError && page.error.status === 404;
    return (
      <ErrorState
        title={notFound ? "Not found" : "This person"}
        message={
          notFound
            ? "Nobody with this link, or you can't see customers in this workspace."
            : page.error instanceof ApiError
              ? page.error.message
              : "The page could not be loaded."
        }
      />
    );
  }
  return <CustomerProfileView data={page.data} />;
}

export default function StaffCustomerProfilePage() {
  return (
    <Protected>
      <Profile />
    </Protected>
  );
}
