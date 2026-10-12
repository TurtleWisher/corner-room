"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

import { LoadingState } from "@/components/async-state";

export default function CampaignSearchRoutePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();

  useEffect(() => {
    if (params.id) {
      router.replace(`/staff/campaigns/${params.id}`);
    }
  }, [params.id, router]);

  return <LoadingState label="Opening campaign" />;
}
