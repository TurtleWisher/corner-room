import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { CustomersKitBoard } from "./board";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Customers · Corner Room", robots: { index: false, follow: false } };

/* Customers and users and one person's page (D-CUSTOMERS-03) in the staff world. Developer
 * reference only (hidden in production unless CR_THEME_KIT=1). Every value is SAMPLE CONTENT. */
export default function CustomersKitPage() {
  if (process.env.NODE_ENV === "production" && process.env.CR_THEME_KIT !== "1") notFound();
  return (
    <main id="main" data-theme="staff" className="cr-scope min-h-dvh">
      <div className="st-page mx-auto max-w-[88rem] px-4 py-6 md:px-8 md:py-8">
        <CustomersKitBoard />
      </div>
    </main>
  );
}
