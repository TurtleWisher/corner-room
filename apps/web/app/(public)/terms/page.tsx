import type { Metadata } from "next";

import { LegalPage } from "@/components/legal/legal-page";
import { TERMS } from "@/lib/legal-content";

export const metadata: Metadata = { title: "Terms of use · Corner Room" };

export default function TermsPage() {
  return <LegalPage doc={TERMS} path="/terms" />;
}
