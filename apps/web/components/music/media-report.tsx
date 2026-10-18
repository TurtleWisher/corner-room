"use client";

/* What Corner Room's checks found for one master: status, measured facts, findings. Polls only
 * while the server is still working; everything shown comes from the media report API. */

import { useEffect, useState } from "react";
import { CircleAlert, CircleCheck, Loader2, TriangleAlert } from "lucide-react";

import { fetchMediaReport } from "@/features/catalog/api";
import { downloadCopy, factRows, findingRows, reportHeadline, shouldPoll, streamingCopies, type MediaReport as Report } from "@/lib/media-report-view";

const POLL_MS = 4000;

export function MediaReport({ trackId, versionId, onSettled }: { trackId: string; versionId: string; onSettled?: () => void }) {
  const [report, setReport] = useState<Report | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const next = await fetchMediaReport(trackId, versionId);
        if (!alive) return;
        setReport(next);
        setFailed(false);
        if (shouldPoll(next)) timer = setTimeout(load, POLL_MS);
        else onSettled?.();
      } catch {
        if (alive) setFailed(true);
      }
    };
    void load();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
    // onSettled is a notification only; re-running on its identity would restart polling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackId, versionId]);

  if (failed && !report) return <p className="mt-2 text-sm text-fg-muted">The check results couldn&apos;t be loaded.</p>;
  if (!report) return null;
  const head = reportHeadline(report);
  const facts = factRows(report.inspection);
  const findings = findingRows(report.findings);
  const streaming = streamingCopies(report.renditions);
  const download = downloadCopy(report.renditions);

  return (
    <div className="mt-3 border-l-2 border-line pl-4 text-sm" aria-live="polite">
      <p className={`inline-flex items-center gap-2 font-semibold ${head.tone === "attention" ? "text-danger" : head.tone === "good" ? "text-success" : "text-fg"}`}>
        {head.tone === "progress" ? <Loader2 aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" /> : null}
        {head.tone === "good" ? <CircleCheck aria-hidden="true" className="size-4" /> : null}
        {head.tone === "attention" ? <CircleAlert aria-hidden="true" className="size-4" /> : null}
        {head.text}
      </p>
      {findings.length > 0 ? (
        <ul className="mt-2 grid gap-2">
          {findings.map((f) => (
            <li key={f.code} className={`flex items-start gap-2 ${f.blocking ? "text-danger" : "text-fg"}`}>
              {f.blocking ? (
                <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              ) : (
                <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-highlight" />
              )}
              <span>
                <span className="sr-only">{f.blocking ? "Must fix: " : "Warning: "}</span>
                {f.text}
                {f.detail ? <span className="block text-fg-muted">{f.detail}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {facts.length > 0 ? (
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-4">
          {facts.map((row) => (
            <div key={row.label}>
              <dt className="text-fg-muted">{row.label}</dt>
              <dd className="cr-num font-semibold text-fg">{row.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {streaming ? <p className="mt-2 text-fg-muted">Streaming copies: {streaming}</p> : null}
      {download ? <p className="mt-1 text-fg-muted">Download copy for buyers: {download}</p> : null}
    </div>
  );
}
