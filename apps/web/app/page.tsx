import { ErrorState } from "@/components/async-state";
import { Card } from "@/components/ui/card";
import { fetchHealth } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  let health: { status: string; checks?: { database: boolean; redis: boolean } } | null = null;
  let error: string | null = null;
  try {
    health = await fetchHealth();
  } catch {
    error = "The API is not reachable. Start FastAPI on port 8000, then refresh.";
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Platform foundation</h1>
        <p className="mt-2 text-neutral-600">
          English-first shell. This UI calls the FastAPI API only — no domain or money logic lives
          here.
        </p>
      </div>
      <Card>
        <h2 className="text-sm font-medium text-neutral-500">API health</h2>
        {error ? (
          <div className="mt-3">
            <ErrorState title="API unavailable" message={error} />
          </div>
        ) : (
          <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
            <dt>Status</dt>
            <dd>{health?.status}</dd>
            <dt>Database</dt>
            <dd>{health?.checks?.database ? "ready" : "down"}</dd>
            <dt>Redis</dt>
            <dd>{health?.checks?.redis ? "ready" : "down"}</dd>
          </dl>
        )}
      </Card>
    </div>
  );
}
