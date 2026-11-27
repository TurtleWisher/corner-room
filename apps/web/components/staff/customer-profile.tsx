"use client";

/*
 * One person's page for staff (owner, 2026-11-27, D-CUSTOMERS-03), drawn from the server's profile
 * read. Used by /staff/customers/[key] and the sample board /theme-kit/customers.
 */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ExternalLink, Search } from "lucide-react";

import { DateTime, Money } from "@/components/ds";
import { useSpotlight } from "@/components/ds/spotlight";
import { Tabs } from "@/components/ds/tabs";
import { CopyButton, LiveDot, PersonMark, StatTile, TonePill, useNow } from "@/components/staff/customers-kit";
import {
  ACCOUNT_STATUS,
  activityOf,
  byDay,
  currencies,
  dayWord,
  deviceLabel,
  filterMoments,
  giftState,
  isRecent,
  itemKind,
  listenShare,
  momentWords,
  orderSteps,
  paidWithLabel,
  paymentLabel,
  paymentTone,
  refundReason,
  timeAgo,
  TIMELINE_FILTERS,
  type CustomerProfile,
  type ProfileOrder,
  type TimelineGroup,
} from "@/lib/customer-profile-view";
import { ACCOUNT_TYPE_LABEL, type AccountType } from "@/lib/customers-view";
import { formatCount } from "@/lib/format/count";
import { humanizeStatus } from "@/lib/format/status";

const PARTS = ["timeline", "orders", "music", "gifts", "sign-ins"] as const;
type Part = (typeof PARTS)[number];

function MoneyList({ map, empty = "None" }: { map: Record<string, number>; empty?: string }) {
  const list = currencies(map);
  if (!list.length) return <>{empty}</>;
  return (
    <>
      {list.map((m) => (
        <Money key={m.currency_code} value={m} minorDigits="always" className="block" />
      ))}
    </>
  );
}

function When({ at, now }: { at: string | null | undefined; now: Date }) {
  if (!at) return <span className="text-fg-muted">Not available</span>;
  const ago = timeAgo(at, now);
  return (
    <span title={new Date(at).toLocaleString()}>
      {ago ? `${ago} · ` : null}
      <DateTime value={at} format="datetime" />
    </span>
  );
}

// ---------- hero ----------

function Hero({ data, now }: { data: CustomerProfile; now: Date }) {
  const p = data.person;
  const name = p.name?.trim() || p.email?.split("@")[0] || "No name";
  const status = p.account_status ? ACCOUNT_STATUS[p.account_status] : null;
  const recent = isRecent(data.summary.last_activity_at, now);
  return (
    <section className="cx-hero">
      <div className="grid min-w-0 gap-4">
      <div className="cx-glass cr-cut cx-pad cx-rise" data-spot>
        <div className="cx-id">
          <PersonMark name={name} seed={p.key} />
          <div className="min-w-0 flex-1">
            <h1 className="cx-id-name">{name}</h1>
            {p.manages.length ? <p className="cx-quiet mt-1">Runs {p.manages.join(", ")}</p> : null}
            <div className="cx-tags">
              <TonePill tone={paymentTone(data.summary.payment_status)}>{paymentLabel(data.summary.payment_status)}</TonePill>
              {status ? <TonePill tone={status.tone}>{status.label}</TonePill> : <TonePill tone="neutral">No account yet</TonePill>}
              {p.account_types.map((t) => (
                <TonePill key={t} tone={t === "staff" ? "accent" : t === "artist" ? "info" : "neutral"}>
                  {ACCOUNT_TYPE_LABEL[t as AccountType] ?? t}
                </TonePill>
              ))}
              {p.sources.includes("PRESALE") ? <TonePill tone="positive">Pre-sale buyer</TonePill> : null}
              {p.security_locked ? <TonePill tone="negative">Locked for safety</TonePill> : null}
            </div>
          </div>
        </div>
        <p className="cx-quiet mt-4 flex items-center gap-2">
          {recent ? <LiveDot /> : null}
          Last activity: <When at={data.summary.last_activity_at} now={now} />
        </p>
      </div>
      <Tiles data={data} />
      </div>
      <div className="cx-glass cr-cut cx-pad cx-rise" style={{ "--i": 1 } as React.CSSProperties}>
        <h2 className="cx-section-title">Contact and account</h2>
        <dl className="cx-contact">
          <div className="cx-kv">
            <dt>Email</dt>
            <dd>
              {p.email ?? "None"}
              {p.user_id ? <span className="cx-quiet block">{p.email_verified ? "Confirmed" : "Not confirmed yet"}</span> : null}
            </dd>
            {p.email ? <CopyButton value={p.email} label="Copy email" /> : <span />}
          </div>
          <div className="cx-kv">
            <dt>Phone</dt>
            <dd>{p.phone ?? "None"}</dd>
            {p.phone ? <CopyButton value={p.phone} label="Copy phone" /> : <span />}
          </div>
          <div className="cx-kv">
            <dt>Address</dt>
            <dd>{p.address ?? "None"}</dd>
            {p.address ? <CopyButton value={p.address} label="Copy address" /> : <span />}
          </div>
          <div className="cx-kv">
            <dt>Joined</dt>
            <dd>{p.joined_at ? <DateTime value={p.joined_at} format="date" /> : "Not signed up"}</dd>
            <span />
          </div>
          <div className="cx-kv">
            <dt>Last seen</dt>
            <dd>{data.summary.last_seen_at ? <When at={data.summary.last_seen_at} now={now} /> : "Not available"}</dd>
            <span />
          </div>
          <div className="cx-kv">
            <dt>Signs in with</dt>
            <dd>
              {p.sign_in_methods.length
                ? p.sign_in_methods.map((m) => (m === "PASSWORD" ? "Email and password" : m === "GOOGLE" ? "Google" : humanizeStatus(m))).join(", ")
                : "No account"}
            </dd>
            <span />
          </div>
        </dl>
        {p.user_id ? (
          <Link href={`/staff/users/${p.user_id}`} className="cr-focus mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-link underline">
            Roles and account controls <ExternalLink aria-hidden="true" className="size-3.5" />
          </Link>
        ) : null}
      </div>
    </section>
  );
}

function Tiles({ data }: { data: CustomerProfile }) {
  const s = data.summary;
  const tiles = [
    { label: "Spent", value: <MoneyList map={s.spent} empty="Nothing" />, hint: currencies(s.refunded).length ? <>Refunded <MoneyList map={s.refunded} /></> : "Paid orders and pre-sales", tone: "positive" as const },
    { label: "Paid orders", value: formatCount(s.orders_paid), hint: s.presales ? `Plus ${formatCount(s.presales)} pre-sale` : "Songs, releases and tickets" },
    { label: "Waiting for check", value: formatCount(s.waiting), hint: s.rejected ? `${formatCount(s.rejected)} rejected` : "Payments sent, not checked", tone: s.waiting ? ("warning" as const) : undefined },
    { label: "Didn't finish", value: formatCount(s.unfinished), hint: "Opened the payment page, never paid" },
    { label: "Music owned", value: formatCount(s.owned), hint: `${formatCount(s.follows)} acts followed` },
    { label: "Counted listens", value: formatCount(s.listens), hint: `${formatCount(s.gifts_given)} gifts given · ${formatCount(s.gifts_received)} received` },
  ];
  return (
    <div className="cx-tiles" aria-label="At a glance" style={{ "--cx-cols": 3 } as React.CSSProperties}>
      {tiles.map((t, i) => (
        <StatTile key={t.label} label={t.label} value={t.value} hint={t.hint} tone={t.tone} style={{ "--i": i + 2 } as React.CSSProperties} />
      ))}
    </div>
  );
}

// ---------- timeline ----------

function Timeline({ data, now }: { data: CustomerProfile; now: Date }) {
  const [group, setGroup] = useState<"all" | TimelineGroup>("all");
  const [q, setQ] = useState("");
  const moments = useMemo(() => filterMoments(data.timeline, group, q), [data.timeline, group, q]);
  const days = useMemo(() => byDay(moments), [moments]);
  return (
    <div className="cx-glass cr-cut cx-pad grid gap-3">
      <div className="cx-toolbar">
        <div className="cx-chips" role="group" aria-label="Show on the timeline">
          {TIMELINE_FILTERS.map((f) => (
            <button key={f.key} type="button" className="cx-chip cr-cut cr-focus" aria-pressed={group === f.key} onClick={() => setGroup(f.key)}>
              {f.label}
            </button>
          ))}
        </div>
        <label className="cx-search cr-cut">
          <Search aria-hidden="true" />
          <span className="sr-only">Search the timeline</span>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search this history" maxLength={120} />
        </label>
      </div>
      {days.length === 0 ? (
        <p className="cx-quiet py-6 text-center">Nothing here{q ? ` matches “${q}”` : ""}.</p>
      ) : (
        <ol className="cx-tl">
          {days.map(({ day, moments: list }) => (
            <li key={day} className="cx-tl-day">
              <h3 className="cx-tl-dayhead">
                {dayWord(day, now) ?? <DateTime value={`${day}T12:00:00+06:00`} format="date" />}
                <span className="font-normal normal-case tracking-normal">
                  {formatCount(list.length)} {list.length === 1 ? "thing" : "things"}
                </span>
              </h3>
              <ul className="cx-tl-list">
                {list.map((m, i) => {
                  const { headline, sub } = momentWords(m);
                  const tone = activityOf(m.kind)?.tone ?? "neutral";
                  return (
                    <li key={`${m.at}-${m.kind}-${i}`} className="cx-moment">
                      <span className="cx-dot" data-tone={tone} aria-hidden="true" />
                      <span className="cx-moment-head">{headline}</span>
                      {sub ? <span className="cx-moment-sub">{sub}</span> : null}
                      <span className="cx-moment-side">
                        <DateTime value={m.at} format="time" />
                        {m.amount_minor != null && m.currency_code ? (
                          <Money className="cx-money" value={{ amount_minor: m.amount_minor, currency_code: m.currency_code }} minorDigits="always" />
                        ) : null}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ol>
      )}
      {data.timeline_truncated ? <p className="cx-quiet">Showing the newest 400 moments.</p> : null}
    </div>
  );
}

// ---------- orders ----------

function OrderCard({ o, now }: { o: ProfileOrder; now: Date }) {
  const title = o.items.map((i) => i.name).join(", ") || itemKind(o.purpose);
  const flags = [o.is_presale ? "Pre-order" : null, o.is_gift ? "Bought as a gift" : null, o.is_music_gift ? "Gift from an act" : null].filter(Boolean);
  return (
    <article className="cx-order cr-cut">
      <div className="cx-order-top">
        <div className="min-w-0">
          <p className="cx-order-what">{title}</p>
          <p className="cx-quiet">
            Opened <When at={o.created_at} now={now} />
            {flags.length ? ` · ${flags.join(" · ")}` : ""}
          </p>
        </div>
        <div className="grid justify-items-end gap-1">
          <Money className="cx-order-amount" value={{ amount_minor: o.amount_minor, currency_code: o.currency_code }} minorDigits="always" />
          <TonePill tone={paymentTone(o.status)}>{paymentLabel(o.status)}</TonePill>
        </div>
      </div>
      <ol className="cx-steps" aria-label="How this order went">
        {orderSteps(o).map((s) => (
          <li key={s.label} className="cx-step" data-state={s.state}>
            <span className="cx-step-bar" aria-hidden="true" />
            <span>
              {s.label}
              <span className="sr-only">: {s.state === "done" ? "done" : s.state === "wait" ? "waiting" : s.state === "bad" ? "did not happen" : "not yet"}</span>
            </span>
          </li>
        ))}
      </ol>
      {o.items.length > 1 || o.items.some((i) => i.quantity > 1) ? (
        <ul className="cx-mini">
          {o.items.map((i, n) => (
            <li key={n}>
              <span>
                {i.name} <span className="cx-quiet">· {itemKind(i.kind)}{i.quantity > 1 ? ` × ${i.quantity}` : ""}</span>
              </span>
              <Money value={{ amount_minor: i.amount_minor, currency_code: i.currency_code }} minorDigits="always" />
            </li>
          ))}
        </ul>
      ) : null}
      {o.submissions.length ? (
        <div className="cx-attempts">
          <p className="cx-quiet">What they sent ({formatCount(o.submissions.length)})</p>
          {o.submissions.map((s, n) => (
            <div key={n} className="cx-attempt cr-cut">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-1">
                  <span className="cx-quiet">Transaction ID</span> <span className="cx-mono font-semibold">{s.transaction_ref}</span>
                  <CopyButton value={s.transaction_ref} label="Copy transaction ID" />
                </span>
                <TonePill tone={s.status === "CONFIRMED" ? "positive" : s.status === "REJECTED" ? "negative" : "warning"}>
                  {s.status === "CONFIRMED" ? "Confirmed" : s.status === "REJECTED" ? "Rejected" : "Waiting for check"}
                </TonePill>
              </div>
              <span>
                From <span className="cx-mono">{s.paid_from}</span> · via {paidWithLabel(s.paid_with)} · sent <When at={s.sent_at} now={now} />
              </span>
              {s.decided_at ? (
                <span className="cx-quiet">
                  Checked <When at={s.decided_at} now={now} />
                  {s.decision_note ? ` · Reason: ${s.decision_note}` : ""}
                </span>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      {o.paid_with_credit_minor > 0 ? (
        <p className="cx-quiet">
          Paid with gift credit: <Money value={{ amount_minor: o.paid_with_credit_minor, currency_code: o.currency_code }} minorDigits="always" />
        </p>
      ) : null}
      {o.refunds.length ? (
        <ul className="cx-mini">
          {o.refunds.map((r, n) => (
            <li key={n}>
              <span>
                Refund · {refundReason(r.reason_code)} <span className="cx-quiet">· {humanizeStatus(r.status)} · <DateTime value={r.requested_at} format="date" /></span>
              </span>
              <Money value={{ amount_minor: r.amount_minor, currency_code: r.currency_code }} minorDigits="always" />
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-fg-muted">
        <span>{o.delivery_address ? `Deliver to: ${o.delivery_address}` : null}</span>
        <span className="flex items-center gap-1">
          Order <span className="cx-mono">{o.order_id.slice(0, 8)}</span>
          <CopyButton value={o.order_id} label="Copy order ID" />
        </span>
      </div>
    </article>
  );
}

function Orders({ data, now }: { data: CustomerProfile; now: Date }) {
  return (
    <div className="grid gap-4">
      {data.presales.length ? (
        <section className="cx-glass cr-cut cx-pad">
          <h3 className="cx-section-title">Paid before launch (pre-sale sheet)</h3>
          <ul className="cx-mini">
            {data.presales.map((c, n) => (
              <li key={n}>
                <span>
                  {c.product ?? "Product"}{" "}
                  <span className="cx-quiet">
                    · {c.status === "CLAIMED" ? "unlocked on their account" : c.status === "CANCELLED" ? "cancelled" : "waiting for them to sign up"}
                    {c.paid_on ? ` · paid on ${c.paid_on}` : ""}
                  </span>
                </span>
                <Money value={{ amount_minor: c.amount_minor, currency_code: c.currency_code }} minorDigits="always" />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {data.orders.length === 0 ? (
        <p className="cx-quiet py-6 text-center">No orders on Corner Room.</p>
      ) : (
        <div className="cx-orders">
          {data.orders.map((o) => (
            <OrderCard key={o.order_id} o={o} now={now} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- music, gifts, sign-ins ----------

function Music({ data }: { data: CustomerProfile }) {
  const top = data.top_songs[0]?.listens ?? 0;
  return (
    <div className="cx-grid-2">
      <section className="cx-glass cr-cut cx-pad">
        <h3 className="cx-section-title">
          Music they own <span className="cx-quiet">{formatCount(data.library.filter((l) => l.status === "ACTIVE").length)}</span>
        </h3>
        {data.library.length === 0 ? (
          <p className="cx-quiet">Nothing yet.</p>
        ) : (
          <ul className="cx-mini">
            {data.library.map((l, n) => (
              <li key={n}>
                <span>
                  {l.title} <span className="cx-quiet">· {itemKind(l.kind)}{l.status !== "ACTIVE" ? ` · ${humanizeStatus(l.status)}` : ""}</span>
                </span>
                <span className="cx-quiet">
                  <DateTime value={l.since} format="date" />
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <div className="grid gap-4">
        <section className="cx-glass cr-cut cx-pad">
          <h3 className="cx-section-title">
            What they listen to <span className="cx-quiet">{formatCount(data.summary.listens)} counted listens</span>
          </h3>
          {data.top_songs.length === 0 ? (
            <p className="cx-quiet">No counted listens yet.</p>
          ) : (
            <ul className="cx-mini">
              {data.top_songs.map((s, n) => (
                <li key={n} className="block">
                  <span className="flex justify-between gap-3">
                    <span>{s.title}</span>
                    <span className="tabular-nums">{formatCount(s.listens)}</span>
                  </span>
                  <span className="cx-bar" aria-hidden="true">
                    <span style={{ width: `${(listenShare(s.listens, top) * 100).toFixed(1)}%` }} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="cx-glass cr-cut cx-pad">
          <h3 className="cx-section-title">Follows</h3>
          {data.follows.length === 0 ? (
            <p className="cx-quiet">Follows nobody yet.</p>
          ) : (
            <ul className="cx-mini">
              {data.follows.map((f, n) => (
                <li key={n}>
                  <span>
                    {f.name} <span className="cx-quiet">· {f.kind === "BAND" ? "band" : "artist"}{f.active ? "" : " · unfollowed"}</span>
                  </span>
                  <span className="cx-quiet">
                    <DateTime value={f.since} format="date" />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function Gifts({ data }: { data: CustomerProfile }) {
  return (
    <div className="cx-grid-2">
      <div className="grid gap-4">
        <section className="cx-glass cr-cut cx-pad">
          <h3 className="cx-section-title">Gifts they gave</h3>
          {data.gifts_given.length === 0 ? (
            <p className="cx-quiet">None.</p>
          ) : (
            <ul className="cx-mini">
              {data.gifts_given.map((g, n) => (
                <li key={n}>
                  <span>
                    {g.music}{" "}
                    <span className="cx-quiet">
                      · to {formatCount(g.people)} {g.people === 1 ? "person" : "people"} · {g.people_states.map(giftState).join(", ") || giftState(g.status)}
                    </span>
                  </span>
                  <span className="cx-quiet">
                    <DateTime value={g.at} format="date" />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="cx-glass cr-cut cx-pad">
          <h3 className="cx-section-title">Gifts they received</h3>
          {data.gifts_received.length === 0 ? (
            <p className="cx-quiet">None.</p>
          ) : (
            <ul className="cx-mini">
              {data.gifts_received.map((g, n) => (
                <li key={n}>
                  <span>
                    {g.music ?? "Music"}{" "}
                    <span className="cx-quiet">
                      · {g.kind === "MUSIC_GIFT" ? "from the act" : "from a fan"}
                      {g.from ? ` ${g.from}` : ""} · {giftState(g.status)}
                    </span>
                  </span>
                  <span className="cx-quiet">
                    <DateTime value={g.at} format="date" />
                  </span>
                </li>
              ))}
            </ul>
          )}
          {currencies(data.summary.credit).length ? (
            <p className="cx-quiet mt-3">
              Gift credit left: <MoneyList map={data.summary.credit} />
            </p>
          ) : null}
        </section>
      </div>
      <section className="cx-glass cr-cut cx-pad">
        <h3 className="cx-section-title">
          Emails acts sent them <span className="cx-quiet">{formatCount(data.emails.length)}</span>
        </h3>
        {data.emails.length === 0 ? (
          <p className="cx-quiet">None.</p>
        ) : (
          <ul className="cx-mini">
            {data.emails.map((m, n) => (
              <li key={n}>
                <span className="min-w-0">
                  <span className="block truncate">{m.subject}</span>
                  <span className="cx-quiet">
                    {m.from_name} · {m.status === "SENT" ? "Sent" : humanizeStatus(m.status)}
                  </span>
                </span>
                <span className="cx-quiet shrink-0">
                  <DateTime value={m.at} format="date" />
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="cx-quiet mt-3">Which links a person pressed is never recorded per person, only counted for the act.</p>
      </section>
    </div>
  );
}

function SignIns({ data, now }: { data: CustomerProfile; now: Date }) {
  return (
    <section className="cx-glass cr-cut cx-pad">
      <h3 className="cx-section-title">
        Where they signed in <span className="cx-quiet">newest first</span>
      </h3>
      {data.sign_ins.length === 0 ? (
        <p className="cx-quiet">No sign-ins recorded.</p>
      ) : (
        <ul className="cx-mini">
          {data.sign_ins.map((s, n) => (
            <li key={n}>
              <span className="flex items-center gap-2">
                {s.active ? <TonePill tone="positive">Signed in now</TonePill> : <TonePill tone="neutral">Ended</TonePill>}
                {deviceLabel(s.device)}
              </span>
              <span className="cx-quiet text-right">
                Signed in <DateTime value={s.signed_in_at} format="datetime" />
                <span className="block">Last used {s.last_used_at ? (timeAgo(s.last_used_at, now) ?? <DateTime value={s.last_used_at} format="date" />) : "Not available"}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="cx-quiet mt-3">Network addresses are kept in the audit log only, not shown here.</p>
    </section>
  );
}

function partFromHash(): Part {
  if (typeof window === "undefined") return "timeline";
  const h = window.location.hash.replace("#", "");
  return (PARTS as readonly string[]).includes(h) ? (h as Part) : "timeline";
}

/** The whole page for one person. `now` can be fixed (the sample board), else it ticks. */
export function CustomerProfileView({ data, now: fixedNow }: { data: CustomerProfile; now?: Date }) {
  const ticking = useNow();
  const now = fixedNow ?? ticking;
  const spotRef = useSpotlight<HTMLDivElement>();
  const [part, setPart] = useState<Part>("timeline");
  useEffect(() => setPart(partFromHash()), []);
  const name = data.person.name?.trim() || data.person.email?.split("@")[0] || "No name";
  const s = data.summary;

  return (
    <div className="cx" data-module="customers" ref={spotRef}>
      <nav className="cx-crumbs" aria-label="Breadcrumb">
        <Link href="/staff/customers" className="cr-focus inline-flex items-center gap-1">
          <ArrowLeft aria-hidden="true" className="size-3.5" /> Customers and users
        </Link>
        <span aria-hidden="true">/</span>
        <span className="text-fg">{name}</span>
      </nav>
      <Hero data={data} now={now} />
      <Tabs
        label="This person's history"
        value={part}
        onValueChange={(id) => {
          setPart(id as Part);
          history.replaceState(null, "", `#${id}`);
        }}
        keepMounted
        items={[
          { id: "timeline", label: "Timeline", content: <Timeline data={data} now={now} /> },
          {
            id: "orders",
            label: `Orders and payments (${formatCount(data.orders.length + data.presales.length)})`,
            content: <Orders data={data} now={now} />,
          },
          { id: "music", label: "Music and listening", content: <Music data={data} /> },
          { id: "gifts", label: `Gifts and emails (${formatCount(s.gifts_given + s.gifts_received + data.emails.length)})`, content: <Gifts data={data} /> },
          { id: "sign-ins", label: "Sign-ins", content: <SignIns data={data} now={now} />, disabled: !data.person.user_id },
        ]}
        panelClassName="pt-4"
      />
    </div>
  );
}
