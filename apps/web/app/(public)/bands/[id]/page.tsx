"use client";

import { useParams } from "next/navigation";

import { ProfilePage } from "@/components/artists/profile";

export default function BandPage() {
  const { id } = useParams<{ id: string }>();
  return <ProfilePage kind="band" id={id} />;
}
