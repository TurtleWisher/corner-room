"use client";

/* One Corner Room Wrap, end to end (owner, 2026-11-28, D-WRAP-01). */

import { useParams } from "next/navigation";

import { useAuth } from "@/components/auth-provider";
import { ErrorState, LoadingState, Protected } from "@/components/staff/kit";
import { WrapEditor } from "@/components/staff/wrap-editor";
import { useAsync } from "@/components/use-async";
import { fetchStaffWrap, fetchStaffWraps } from "@/features/wraps/api";
import { friendlyError } from "@/lib/error-copy";

function Editor({ id }: { id: string }) {
  const auth = useAuth();
  const data = useAsync(() => Promise.all([fetchStaffWrap(id), fetchStaffWraps()]), [id]);
  if (data.status === "loading") return <LoadingState />;
  if (data.status === "error") return <ErrorState message={friendlyError(data.error, "This Wrap couldn't be loaded. Wraps are for platform admins.")} />;
  const [wrap, list] = data.data;
  const first = auth.user?.display_name?.split(/\s+/)[0] ?? null;
  return <WrapEditor initial={wrap} options={list.options} staffFirstName={first} />;
}

export default function StaffWrapPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <Protected>
      <Editor id={id} />
    </Protected>
  );
}
