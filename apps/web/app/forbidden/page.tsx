import { ErrorState } from "@/components/async-state";

export default function ForbiddenPage() {
  return (
    <ErrorState
      title="Not permitted"
      message="You are signed in but do not have permission for this action. Server authorization is authoritative."
    />
  );
}
