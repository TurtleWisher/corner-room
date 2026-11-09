"use client";

/* Studio > Gifts > Emails moved into the Mailbox (owner, 2026-11-09, D-MAILBOX-01). Old links keep
 * working: a gift campaign's updates (`?view=gifts&campaign=<id>`) open that campaign's Emails part,
 * the report opens the Mailbox report, and anything else opens the Mailbox. */

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { Skeleton } from "@/components/ds";
import { AccountPage } from "@/components/shell/account-page";
import { oldEmailsTarget } from "@/lib/mailbox-view";

export default function StudioEmailsMovedPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace(oldEmailsTarget(window.location.search));
  }, [router]);
  return (
    <AccountPage audience="artist" eyebrow="Studio" title="Mailbox" what="your mailbox">
      <Skeleton className="h-48 w-full" />
    </AccountPage>
  );
}
