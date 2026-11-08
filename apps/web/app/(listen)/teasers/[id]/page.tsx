"use client";

/* The Preview Room (owner, 2026-11-07, D-TEASER-00 to D-TEASER-04, URL-11): anyone can listen, as
 * often as they like, without buying the song or signing in. */

import { useParams } from "next/navigation";

import { TeaserRoom } from "@/components/teasers/teaser-room";

export default function TeaserPage() {
  const { id } = useParams<{ id: string }>();
  return <TeaserRoom teaserId={id} />;
}
