"use client";

/* One teaser in the Preview Studio (owner, 2026-11-07, D-TEASER-00, URL-11). */

import { useParams } from "next/navigation";

import { AccountPage } from "@/components/shell/account-page";
import { TeaserEditor } from "@/components/teasers/teaser-editor";

export default function TeaserEditorPage() {
  const { id, teaserId } = useParams<{ id: string; teaserId: string }>();
  return (
    <AccountPage audience="artist" eyebrow="Preview Studio" title="Edit teaser" what="your teaser" compact>
      <TeaserEditor teaserId={teaserId} releaseId={id} />
    </AccountPage>
  );
}
