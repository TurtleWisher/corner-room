"use client";

/* Preview Studio for one release on its own page (owner, 2026-11-07, D-TEASER-00, URL-11). The same
 * list is the release page's Preview Studio part (D-RELEASE-TABS-01), where the Studio links now. */

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { AccountPage } from "@/components/shell/account-page";
import { PreviewStudioList } from "@/components/teasers/preview-studio-list";

export default function ReleaseTeasersPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <AccountPage audience="artist" eyebrow="Studio" title="Preview Studio" what="your teasers" compact>
      <Link href={`/studio/releases/${id}#preview`} className="cr-focus mb-5 inline-flex items-center gap-1 text-sm font-semibold text-link hover:underline">
        <ArrowLeft aria-hidden="true" className="size-4" /> Back to the release
      </Link>
      <PreviewStudioList releaseId={id} />
    </AccountPage>
  );
}
