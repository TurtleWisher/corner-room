"use client";

/*
 * Email reports for an act (owner, 2026-11-02, D-MAIL-02): counts only, never money. Rates read
 * "Not available" until something was sent (analytics honesty), and who clicked is never shown.
 * Each measure gets its own small chart in the Studio accent on one shared day axis (small multiples,
 * no second axis, no second colour); every chart has a hover readout and a table view.
 */

import { useMemo, useState } from "react";
import { BarChart3, Table2 } from "lucide-react";

import { ErrorState, Skeleton } from "@/components/ds";
import { RetryButton } from "@/components/shell/staff-panel";
import { Segmented } from "@/components/artist-mail/audience-builder";
import { loadErrorMessage, useAsync } from "@/components/use-async";
import { fetchActMailReport, fetchMailReport, type MailProfile } from "@/features/artist-mail/api";
import { OCCASION_LABEL } from "@/lib/artist-mail-starters";
import { percent, thankYouLabel, whenLine } from "@/lib/artist-mail-view";

const count = (n: number) => new Intl.NumberFormat("en-IN").format(n);

function Kpi({ label, value, note }: { label: string; value: string; note?: string }) {
  const na = value === "Not available";
  return (
    <div className="am-kpi">
      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-fg-muted">{label}</p>
      <p className="am-kpi-value" data-na={na || undefined}>
        {value}
      </p>
      {note ? <p className="mt-1 text-xs text-fg-muted">{note}</p> : null}
    </div>
  );
}

type Point = { label: string; value: number };

/** Thin bars from a baseline, rounded at the data end, with a hover readout. */
function Bars({ title, points, unit }: { title: string; points: Point[]; unit: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const width = 640;
  const height = 110;
  const pad = { top: 8, bottom: 2, left: 4, right: 4 };
  const max = Math.max(1, ...points.map((p) => p.value));
  const step = (width - pad.left - pad.right) / Math.max(1, points.length);
  const bar = Math.max(1, Math.min(14, step - 2));
  const y = (v: number) => pad.top + (height - pad.top - pad.bottom) * (1 - v / max);
  const total = points.reduce((s, p) => s + p.value, 0);
  const shown = hover !== null ? points[hover] : null;
  if (total === 0) {
    return (
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line pb-2 text-sm">
        <span className="font-semibold text-fg">{title}</span>
        <span className="text-fg-muted">Nothing yet in this time</span>
      </div>
    );
  }
  return (
    <figure className="grid gap-1">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <span className="font-semibold text-fg">{title}</span>
        <span className="text-fg-muted" aria-live="polite">
          {shown ? `${shown.label}: ${count(shown.value)} ${unit}` : `${count(total)} ${unit} in all`}
        </span>
      </figcaption>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="am-chart h-auto w-full"
        role="img"
        aria-label={`${title}: ${count(total)} ${unit} over ${points.length} days`}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          const x = ((e.clientX - box.left) / box.width) * width - pad.left;
          setHover(Math.max(0, Math.min(points.length - 1, Math.floor(x / step))));
        }}
      >
        <line x1={pad.left} x2={width - pad.right} y1={height - pad.bottom} y2={height - pad.bottom} stroke="var(--cr-line)" strokeWidth="1" />
        {points.map((p, i) => {
          const x = pad.left + i * step + (step - bar) / 2;
          const top = y(p.value);
          const h = height - pad.bottom - top;
          return (
            <g key={p.label}>
              {hover === i ? <rect x={pad.left + i * step} y={pad.top} width={step} height={height - pad.top - pad.bottom} fill="var(--cr-fg)" opacity="0.06" /> : null}
              {p.value > 0 ? (
                <path
                  d={`M${x},${height - pad.bottom} V${top + Math.min(4, h)} q0,-${Math.min(4, h)} ${Math.min(4, bar / 2)},-${Math.min(4, h)} H${x + bar - Math.min(4, bar / 2)} q${Math.min(4, bar / 2)},0 ${Math.min(4, bar / 2)},${Math.min(4, h)} V${height - pad.bottom} Z`}
                  fill="var(--cr-accent)"
                  opacity={hover === null || hover === i ? 1 : 0.55}
                />
              ) : null}
            </g>
          );
        })}
      </svg>
      <div className="flex justify-between text-xs text-fg-muted" aria-hidden="true">
        <span>{points[0]?.label}</span>
        <span>{points[points.length - 1]?.label}</span>
      </div>
    </figure>
  );
}

/** A share drawn as a bar, with its words beside it; "Not available" has no bar. */
function RateBar({ rate }: { rate: number | null }) {
  return (
    <span className="flex items-center gap-2">
      {rate === null ? null : (
        <span className="am-bar-track block w-16" aria-hidden="true">
          <span className="am-bar-fill block" style={{ width: `${Math.min(100, rate * 100)}%` }} />
        </span>
      )}
      <span className="cr-num text-fg">{percent(rate)}</span>
    </span>
  );
}

const shortDay = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "Asia/Dhaka" }).format(new Date(`${iso}T12:00:00+06:00`));

export function ActMailReport({ profile }: { profile: MailProfile }) {
  const [days, setDays] = useState<"30" | "90" | "365">("90");
  const [asTable, setAsTable] = useState(false);
  const report = useAsync(() => fetchActMailReport(profile, Number(days) as 30 | 90 | 365), [profile.kind, profile.id, days]);
  const series = useMemo(() => (report.status === "ok" ? report.data.series : []), [report]);

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented<"30" | "90" | "365"> label="Time range" value={days} options={{ "30": "Last 30 days", "90": "Last 90 days", "365": "Last year" }} onChange={setDays} />
        <button type="button" className="am-tool" onClick={() => setAsTable(!asTable)} aria-pressed={asTable}>
          {asTable ? <BarChart3 aria-hidden="true" className="size-3.5" /> : <Table2 aria-hidden="true" className="size-3.5" />} {asTable ? "Show charts" : "Show as a table"}
        </button>
      </div>
      {report.status === "loading" ? (
        <Skeleton className="h-64 w-full" />
      ) : report.status === "error" ? (
        <ErrorState title="Report unavailable" message={loadErrorMessage(report.error, "your email report")} action={<RetryButton onClick={report.reload} />} />
      ) : (
        <>
          <div className="am-kpis">
            <Kpi label="Emails to buyers sent" value={count(report.data.emails_sent)} />
            <Kpi label="Thank-yous sent" value={count(report.data.thank_yous_sent)} />
            <Kpi label="People who clicked" value={count(report.data.people_clicked)} note={`${count(report.data.clicks)} clicks in all`} />
            <Kpi label="Click rate" value={percent(report.data.click_rate)} note="People who clicked, of emails sent" />
            <Kpi label="Stopped your emails" value={count(report.data.stops)} />
            <Kpi label="Couldn't be delivered" value={count(report.data.failed)} />
          </div>
          {asTable ? (
            <div className="max-h-96 overflow-auto border border-line">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-surface text-left text-fg-muted">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Day</th>
                    <th className="px-3 py-2 text-right font-semibold">Emails</th>
                    <th className="px-3 py-2 text-right font-semibold">Thank-yous</th>
                    <th className="px-3 py-2 text-right font-semibold">Clicks</th>
                  </tr>
                </thead>
                <tbody className="cr-num">
                  {series.map((d) => (
                    <tr key={d.day} className="border-t border-line">
                      <td className="px-3 py-1.5 text-fg">{shortDay(d.day)}</td>
                      <td className="px-3 py-1.5 text-right text-fg">{d.emails}</td>
                      <td className="px-3 py-1.5 text-right text-fg">{d.thank_yous}</td>
                      <td className="px-3 py-1.5 text-right text-fg">{d.clicks}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="grid gap-5">
              <Bars title="Emails to buyers sent" unit="sent" points={series.map((d) => ({ label: shortDay(d.day), value: d.emails }))} />
              <Bars title="Thank-yous sent" unit="sent" points={series.map((d) => ({ label: shortDay(d.day), value: d.thank_yous }))} />
              <Bars title="Link clicks" unit="clicks" points={series.map((d) => ({ label: shortDay(d.day), value: d.clicks }))} />
            </div>
          )}
          <div className="grid gap-2">
            <h4 className="text-sm font-semibold text-fg">What people clicked</h4>
            {report.data.clicks ? (
              <ul className="grid gap-2 text-sm">
                {(
                  [
                    ["LISTEN", "Listen button"],
                    ["LINK", "Links in your words"],
                    ["FILE", "Files and gifts"],
                  ] as const
                ).map(([k, label]) => (
                  <li key={k} className="grid grid-cols-[9rem_1fr_3rem] items-center gap-3">
                    <span className="text-fg">{label}</span>
                    <span className="am-bar-track block" aria-hidden="true">
                      <span className="am-bar-fill block" style={{ width: `${(report.data.clicks_by_kind[k] / report.data.clicks) * 100}%` }} />
                    </span>
                    <span className="cr-num text-right text-fg">{report.data.clicks_by_kind[k]}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-fg-muted">No clicks yet in this time.</p>
            )}
          </div>
          <div className="grid gap-2">
            <h4 className="text-sm font-semibold text-fg">Emails to buyers</h4>
            {report.data.campaigns.length ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[36rem] text-sm">
                  <thead className="text-left text-fg-muted">
                    <tr>
                      <th className="py-2 pr-3 font-semibold">Email</th>
                      <th className="py-2 pr-3 text-right font-semibold">Sent</th>
                      <th className="py-2 pr-3 font-semibold">Click rate</th>
                      <th className="py-2 text-right font-semibold">Stopped</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.data.campaigns.map((c) => (
                      <tr key={c.id} className="border-t border-line">
                        <td className="py-2 pr-3">
                          <span className="block font-semibold text-fg">{c.subject}</span>
                          <span className="block text-xs text-fg-muted">
                            {[c.occasion ? OCCASION_LABEL[c.occasion] : null, c.sent_at ? whenLine(c.sent_at) : null].filter(Boolean).join(" · ")}
                          </span>
                        </td>
                        <td className="cr-num py-2 pr-3 text-right text-fg">{count(c.sent)}</td>
                        <td className="py-2 pr-3">
                          <RateBar rate={c.click_rate} />
                        </td>
                        <td className="cr-num py-2 text-right text-fg">{c.stops}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-fg-muted">No emails to buyers went out in this time.</p>
            )}
          </div>
          {report.data.thank_yous.length ? (
            <div className="grid gap-2">
              <h4 className="text-sm font-semibold text-fg">Thank-you emails, all time</h4>
              <ul className="grid gap-2 text-sm">
                {report.data.thank_yous.map((t) => (
                  <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-2">
                    <span className="text-fg">
                      {thankYouLabel(t.audience)}
                      {t.on ? "" : " (off)"}
                    </span>
                    <span className="flex items-center gap-4 text-fg-muted">
                      <span className="cr-num">{count(t.sent)} sent</span>
                      <RateBar rate={t.click_rate} />
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

/** One email's results, opened from its row. */
export function OneMailReport({ mailId }: { mailId: string }) {
  const report = useAsync(() => fetchMailReport(mailId), [mailId]);
  if (report.status === "loading") return <Skeleton className="mt-3 h-40 w-full" />;
  if (report.status === "error") {
    return <ErrorState title="Report unavailable" message={loadErrorMessage(report.error, "this email's report")} action={<RetryButton onClick={report.reload} />} />;
  }
  const r = report.data;
  return (
    <div className="mt-4 grid gap-5 border-t border-line pt-4">
      <div className="am-kpis">
        <Kpi label="Reached" value={r.reached === null ? "Not available" : count(r.reached)} />
        <Kpi label="Sent" value={count(r.sent)} note={r.waiting ? `${r.waiting} still sending` : undefined} />
        <Kpi label="People who clicked" value={count(r.people_clicked)} note={`${count(r.clicks)} clicks`} />
        <Kpi label="Click rate" value={percent(r.click_rate)} />
        <Kpi label="Stopped your emails" value={count(r.stops)} note={r.stopped_before ? `${r.stopped_before} had stopped before it went` : undefined} />
        <Kpi label="Couldn't be delivered" value={count(r.failed)} />
      </div>
      {r.links.length ? (
        <div className="grid gap-2">
          <h5 className="text-sm font-semibold text-fg">Links</h5>
          <ul className="grid gap-2 text-sm">
            {r.links.map((l) => {
              const top = Math.max(1, ...r.links.map((x) => x.people));
              return (
                <li key={l.position} className="grid grid-cols-[minmax(0,1fr)_6rem_5rem] items-center gap-3">
                  <span className="min-w-0 truncate text-fg" title={l.url ?? undefined}>
                    {l.kind === "LISTEN" ? "Listen button" : l.kind === "FILE" ? `File: ${l.label}` : l.label}
                  </span>
                  <span className="am-bar-track block" aria-hidden="true">
                    <span className="am-bar-fill block" style={{ width: `${(l.people / top) * 100}%` }} />
                  </span>
                  <span className="cr-num text-right text-fg">
                    {l.people} {l.people === 1 ? "person" : "people"}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      {r.timeline.length ? (
        <Bars title="Clicks over time (Bangladesh time)" unit="clicks" points={r.timeline.map((t) => ({ label: t.at.length > 10 ? `${t.at.slice(5, 10)} ${t.at.slice(11)}` : t.at.slice(5), value: t.clicks }))} />
      ) : (
        <p className="text-sm text-fg-muted">No clicks yet.</p>
      )}
    </div>
  );
}
