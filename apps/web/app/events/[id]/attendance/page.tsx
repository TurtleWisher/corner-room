"use client";

import { FormEvent, useEffect, useState } from "react";
import { useParams } from "next/navigation";

import { Protected } from "@/components/protected";
import { EmptyState, ErrorState, LoadingState } from "@/components/async-state";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ApiError, checkInTicket, fetchAttendance, type CheckInRecord } from "@/lib/api";

function AttendanceBody() {
  const params = useParams<{ id: string }>();
  const eventId = params.id;
  const [rows, setRows] = useState<CheckInRecord[]>([]);
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function reload() {
    const page = await fetchAttendance(eventId);
    setRows(page.items);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        await reload();
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Unable to load attendance");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  async function onScan(form: FormEvent) {
    form.preventDefault();
    setActionError(null);
    try {
      await checkInTicket(token);
      setToken("");
      await reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Check-in failed");
    }
  }

  if (loading) {
    return <LoadingState label="Loading attendance" />;
  }
  if (error) {
    return <ErrorState title="Attendance unavailable" message={error} />;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Attendance</h1>
      <p className="text-sm text-neutral-600">
        Server-authoritative check-in. Duplicate scans reuse the same attendance row.
      </p>
      {actionError ? <ErrorState title="Check-in failed" message={actionError} /> : null}
      <Card>
        <form onSubmit={onScan} className="space-y-3">
          <Input value={token} onChange={(e) => setToken(e.target.value)} placeholder="Ticket token" />
          <Button type="submit" size="sm">
            Check in
          </Button>
        </form>
      </Card>
      {rows.length === 0 ? (
        <EmptyState message="No check-ins yet." />
      ) : (
        <ul className="space-y-2 text-sm">
          {rows.map((row) => (
            <li key={row.id}>
              {row.status} · ticket {row.ticket_id} · {row.scanned_at}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function AttendancePage() {
  return (
    <Protected>
      <AttendanceBody />
    </Protected>
  );
}
