"use client";

/* Audio processing queue for media operators (media.ops): retry or cancel failed jobs. */

import { useCallback, useEffect, useState } from "react";
import { CircleAlert, RotateCcw, X } from "lucide-react";

import { Button, Card, EmptyState, ErrorState, LoadingState, Protected } from "@/components/staff/kit";
import { cancelMediaJob, fetchMediaJobs, retryMediaJob, type MediaJobRecord } from "@/features/studio/api";
import { friendlyError } from "@/lib/error-copy";

const FILTERS = [
  { key: "DEAD", label: "Stopped (needs a decision)" },
  { key: "FAILED", label: "Retrying" },
  { key: "RUNNING", label: "Running" },
  { key: "QUEUED", label: "Waiting" },
  { key: "", label: "All recent" },
];

export default function MediaProcessingPage() {
  const [filter, setFilter] = useState("DEAD");
  const [jobs, setJobs] = useState<MediaJobRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    setJobs(null);
    setError(null);
    fetchMediaJobs(filter || undefined)
      .then((page) => setJobs(page.items))
      .catch((err) => setError(friendlyError(err, "The processing queue couldn't be loaded. It needs the media operator permission.")));
  }, [filter]);

  useEffect(() => load(), [load]);

  async function act(job: MediaJobRecord, kind: "retry" | "cancel") {
    setBusy(job.id + kind);
    try {
      await (kind === "retry" ? retryMediaJob(job.id) : cancelMediaJob(job.id));
      load();
    } catch (err) {
      setError(friendlyError(err, "That didn't work."));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Protected>
      <div className="grid gap-6">
        <h1 className="text-2xl font-bold">Audio processing</h1>
        <Card className="p-5">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filter jobs">
            {FILTERS.map((f) => (
              <Button key={f.key} variant={filter === f.key ? "default" : "outline"} size="sm" onClick={() => setFilter(f.key)}>
                {f.label}
              </Button>
            ))}
          </div>
          {error ? <ErrorState message={error} /> : jobs === null ? <LoadingState /> : jobs.length === 0 ? (
            <EmptyState message="Nothing here." />
          ) : (
            <table className="mt-4 w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2">Job</th>
                  <th>Status</th>
                  <th>Attempts</th>
                  <th>Last error</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => (
                  <tr key={j.id} className="border-b">
                    <td className="py-2">
                      {j.kind === "INSPECT" ? "Checks" : `Copy: ${j.profile_key}`}
                      <span className="block font-mono text-xs text-muted-foreground">{j.id.slice(0, 8)}</span>
                    </td>
                    <td className={j.status === "DEAD" ? "text-red-600" : ""}>
                      {j.status === "DEAD" ? <CircleAlert aria-hidden="true" className="mr-1 inline size-4" /> : null}
                      {j.status}
                    </td>
                    <td>
                      {j.attempts}/{j.max_attempts}
                    </td>
                    <td>{j.last_error_code ?? "None"}</td>
                    <td className="flex gap-1 py-2">
                      {j.status === "DEAD" || j.status === "FAILED" ? (
                        <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void act(j, "retry")}>
                          <RotateCcw aria-hidden="true" className="size-4" /> Retry
                        </Button>
                      ) : null}
                      {j.status === "DEAD" || j.status === "FAILED" || j.status === "QUEUED" ? (
                        <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void act(j, "cancel")}>
                          <X aria-hidden="true" className="size-4" /> Cancel (artist re-uploads)
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </Protected>
  );
}
