import type { Metadata } from "next";

import { LegalPage } from "@/components/legal/legal-page";
import { REFUNDS } from "@/lib/legal-content";

export const metadata: Metadata = { title: "Refunds · Corner Room" };

export default function RefundsPage() {
  return <LegalPage doc={REFUNDS} path="/refunds" />;
}
