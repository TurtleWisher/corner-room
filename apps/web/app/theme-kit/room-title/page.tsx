import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { RoomTitleBoard } from "./board";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Room title · Corner Room", robots: { index: false, follow: false } };

/* The listening room's one-line title with its version (D-VERSION-01). Developer reference only
 * (hidden in production unless CR_THEME_KIT=1). Every title is SAMPLE CONTENT. */
export default function RoomTitleKitPage() {
  if (process.env.NODE_ENV === "production" && process.env.CR_THEME_KIT !== "1") notFound();
  return <RoomTitleBoard />;
}
