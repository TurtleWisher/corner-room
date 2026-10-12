"use client";

import { useParams } from "next/navigation";

import { ProfilePage } from "@/components/artists/profile";

export default function ArtistPage() {
  const { id } = useParams<{ id: string }>();
  return <ProfilePage kind="artist" id={id} />;
}
