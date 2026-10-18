"use client";

import { useParams } from "next/navigation";

import { AccountPage } from "@/components/shell/account-page";
import { ReleaseEditor } from "@/components/studio/release-editor";

export default function StudioReleasePage() {
  const { id } = useParams<{ id: string }>();
  return (
    <AccountPage audience="artist" eyebrow="Studio" title="Release" what="this release">
      <ReleaseEditor releaseId={id} />
    </AccountPage>
  );
}
