import { ErrorState } from "@/components/async-state";

export default function UnauthorizedPage() {
  return <ErrorState title="Sign in required" message="You need an authenticated session to continue." />;
}
