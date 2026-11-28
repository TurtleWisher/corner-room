import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { WrapBoard } from "./board";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Corner Room Wrap · Corner Room", robots: { index: false, follow: false } };

/* Corner Room Wrap (D-WRAP-01) on sample numbers. Developer reference only (hidden in production
 * unless CR_THEME_KIT=1). Every name and number is SAMPLE CONTENT. */
export default function WrapKitPage() {
  if (process.env.NODE_ENV === "production" && process.env.CR_THEME_KIT !== "1") notFound();
  return <WrapBoard />;
}
