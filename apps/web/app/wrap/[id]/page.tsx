"use client";

/* One person's Corner Room Wrap (owner, 2026-11-28, D-WRAP-01). Staff open `?preview=1` to see a
 * draft with their own listening (never kept). */

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { useAuth } from "@/components/auth-provider";
import { useAsync } from "@/components/use-async";
import { WrapGate } from "@/components/wrap/wrap-gate";
import { WrapStory } from "@/components/wrap/wrap-story";
import { fetchMyWrap } from "@/features/wraps/api";
import { friendlyError } from "@/lib/error-copy";

function Story({ id, preview }: { id: string; preview: boolean }) {
  const wrap = useAsync(() => fetchMyWrap(id, preview), [id, preview]);
  if (wrap.status === "loading") return <WrapGate title="Opening your Wrap" busy />;
  if (wrap.status === "error") {
    return (
      <WrapGate title="This Wrap isn't open" body={friendlyError(wrap.error, "It may have closed, or it isn't open yet.")}>
        <Link href="/wrap" className="wr-pill">
          See Wraps
        </Link>
      </WrapGate>
    );
  }
  return <WrapStory wrap={wrap.data} closeHref={preview ? `/staff/wrap/${id}` : "/wrap"} />;
}

function WrapPage() {
  const { id } = useParams<{ id: string }>();
  const search = useSearchParams();
  const auth = useAuth();
  const preview = search.get("preview") === "1";
  if (auth.status === "loading") return <WrapGate title="Opening your Wrap" busy />;
  if (auth.status !== "authenticated") {
    return (
      <WrapGate title="Sign in to open your Wrap" body="Your Wrap is made from your own listening, so it needs your account.">
        <Link href={`/login?next=${encodeURIComponent(`/wrap/${id}`)}`} className="wr-pill">
          Sign in
        </Link>
      </WrapGate>
    );
  }
  return <Story id={id} preview={preview} />;
}

export default function Page() {
  return (
    <Suspense fallback={<WrapGate title="Opening your Wrap" busy />}>
      <WrapPage />
    </Suspense>
  );
}
