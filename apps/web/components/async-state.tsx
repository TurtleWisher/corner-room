export function LoadingState({ label = "Loading" }: { label?: string }) {
  return (
    <p className="text-sm text-neutral-600" role="status" aria-live="polite">
      {label}…
    </p>
  );
}

export function ErrorState({
  title = "Something went wrong",
  message,
}: {
  title?: string;
  message: string;
}) {
  return (
    <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
      <p className="font-medium">{title}</p>
      <p className="mt-1">{message}</p>
    </div>
  );
}

export function EmptyState({ message }: { message: string }) {
  return <p className="text-sm text-neutral-600">{message}</p>;
}
