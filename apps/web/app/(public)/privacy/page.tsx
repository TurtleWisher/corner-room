import type { Metadata } from "next";

import { LegalPage } from "@/components/legal/legal-page";
import { PRIVACY } from "@/lib/legal-content";

export const metadata: Metadata = { title: "Privacy · Corner Room" };

export default function PrivacyPage() {
  return <LegalPage doc={PRIVACY} path="/privacy" />;
}
