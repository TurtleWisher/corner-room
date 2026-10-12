import { ShieldAlert } from "lucide-react";

import { AuthCard } from "@/components/account/auth-card";
import { ButtonLink } from "@/components/ds";

export default function ForbiddenPage() {
  return (
    <AuthCard title="You do not have access">
      <p className="flex items-start gap-2 text-fg">
        <ShieldAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-warning" />
        Your account cannot open this page. If you think it should, ask an administrator.
      </p>
      <ButtonLink href="/" className="mt-6" block>
        Back to Corner Room
      </ButtonLink>
    </AuthCard>
  );
}
