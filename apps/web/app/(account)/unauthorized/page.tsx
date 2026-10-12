import { AuthCard } from "@/components/account/auth-card";
import { ButtonLink } from "@/components/ds";

export default function UnauthorizedPage() {
  return (
    <AuthCard title="Sign in to continue">
      <p className="text-fg">This page needs you to be signed in.</p>
      <ButtonLink href="/login" className="mt-6" block>
        Sign in
      </ButtonLink>
    </AuthCard>
  );
}
