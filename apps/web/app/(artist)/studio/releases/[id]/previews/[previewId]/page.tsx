"use client";

/* One teaser in the Preview Studio (owner, 2026-11-07, D-TEASER-00, URL-11; at /previews since 2026-11-17, URL-13). */

import { useParams } from "next/navigation";

import { AccountPage } from "@/components/shell/account-page";
import { TeaserEditor } from "@/components/teasers/teaser-editor";

export default function TeaserEditorPage() {
  const { id, previewId } = useParams<{ id: string; previewId: string }>();
  return (
    <AccountPage audience="artist" eyebrow="Preview Studio" title="Edit preview" what="your preview" compact>
      <TeaserEditor teaserId={previewId} releaseId={id} />
    </AccountPage>
  );
}
