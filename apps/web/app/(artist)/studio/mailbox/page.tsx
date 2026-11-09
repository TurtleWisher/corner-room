"use client";

/* Studio > Mailbox (owner, 2026-11-09, D-MAILBOX-01, URL-12): the artist's own mail corner. */

import { ArrowLeft, Gift } from "lucide-react";

import { ButtonLink } from "@/components/ds";
import { Mailbox } from "@/components/mailbox/mailbox";
import { AccountPage } from "@/components/shell/account-page";

export default function StudioMailboxPage() {
  return (
    <AccountPage
      audience="artist"
      eyebrow="Studio"
      title="Mailbox"
      what="your mailbox"
      actions={
        <div className="flex flex-wrap gap-2">
          <ButtonLink href="/studio/gifts" variant="ghost">
            <Gift aria-hidden="true" /> Gifts
          </ButtonLink>
          <ButtonLink href="/studio" variant="secondary">
            <ArrowLeft aria-hidden="true" /> Studio home
          </ButtonLink>
        </div>
      }
    >
      <Mailbox />
    </AccountPage>
  );
}
