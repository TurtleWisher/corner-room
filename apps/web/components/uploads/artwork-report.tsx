"use client";

/* What Corner Room's checks found for the latest artwork upload: a release cover (2026-10-22: a
 * turned-down cover used to say only "Checking your artwork next") or an event poster (OD-06).
 * Polls only while the server is still checking; everything shown comes from the report API. */

import { useEffect, useState } from "react";
import { CircleAlert, CircleCheck, Loader2, TriangleAlert } from "lucide-react";

import type { ArtworkReport as Report } from "@/features/uploads/api";
import { coverUrl } from "@/lib/cover-view";
import { findingRows } from "@/lib/media-report-view";
import { coverReportState } from "@/lib/studio-view";

const POLL_MS = 4000;
// The worker checks a cover within seconds; stop asking after about two minutes.
const MAX_POLLS = 30;

export function ArtworkReport({
  load: loadReport,
  noun = "cover",
  refresh,
  onSettled,
}: {
  /** The report endpoint for this release or event. */
  load: () => Promise<Report | null>;
  noun?: "cover" | "poster";
  refresh: number;
  onSettled?: () => void;
}) {
  const [report, setReport] = useState<Report | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    let polls = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const next = await loadReport();
        if (!alive) return;
        setReport(next);
        setFailed(false);
        if (coverReportState(next, noun).state === "checking" && ++polls < MAX_POLLS) timer = setTimeout(load, POLL_MS);
        else if (polls > 0) onSettled?.();
      } catch {
        if (alive) setFailed(true);
      }
    };
    void load();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
    // The loader and onSettled change identity each render; `refresh` is what asks for a reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh]);

  if (failed && !report) return <p className="mt-3 text-sm text-fg-muted">The {noun} check results couldn&apos;t be loaded.</p>;
  if (!report) return null;
  const head = coverReportState(report, noun);
  const findings = findingRows(report.findings);
  const size = report.width_px && report.height_px ? `${report.width_px} × ${report.height_px} px` : null;

  const preview = coverUrl({ signed: report.cover_url });
  return (
    <div className="mt-4 border-l-2 border-line pl-4 text-sm" aria-live="polite">
      {preview ? (
        // The artwork in use, as uploaded (events: signed link from the report).
        // eslint-disable-next-line @next/next/no-img-element -- signed artwork link from the API
        <img src={preview} alt={`Current ${noun}`} className="mb-3 size-40 object-cover" />
      ) : null}
      <p
        className={`inline-flex items-center gap-2 font-semibold ${head.state === "rejected" ? "text-danger" : head.state === "accepted" ? "text-success" : "text-fg"}`}
      >
        {head.state === "checking" ? <Loader2 aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" /> : null}
        {head.state === "accepted" ? <CircleCheck aria-hidden="true" className="size-4" /> : null}
        {head.state === "rejected" ? <CircleAlert aria-hidden="true" className="size-4" /> : null}
        {head.text}
      </p>
      <p className="mt-1 text-fg-muted">
        Latest upload: <span className="break-all">{report.filename}</span>
        {size ? ` · ${size}` : null}
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
    </div>
  );
}
