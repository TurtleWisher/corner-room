"use client";

import { FormEvent, useEffect, useState } from "react";
import { useParams } from "next/navigation";

import { EmptyState, ErrorState, LoadingState } from "@/components/async-state";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  ApiError,
  fetchBand,
  fetchBandMembers,
  inviteBandMember,
  transitionBand,
  transitionBandMember,
  updateBand,
  type BandMemberRecord,
  type BandRecord,
} from "@/lib/api";

function BandDetailBody() {
  const params = useParams<{ id: string }>();
  const bandId = params.id;
  const [band, setBand] = useState<BandRecord | null>(null);
  const [members, setMembers] = useState<BandMemberRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [memberUserId, setMemberUserId] = useState("");
  const [roleLabel, setRoleLabel] = useState("");

  async function reload() {
    const row = await fetchBand(bandId);
    setBand(row);
    setName(row.name);
    try {
      const memberPage = await fetchBandMembers(bandId);
      setMembers(memberPage.items);
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 404)) {
        throw err;
      }
    }
  }

  useEffect(() => {
    let cancelled = false;
    setBand(null);
    setMembers([]);
    (async () => {
      setLoading(true);
      setError(null);
      try {
        await reload();
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Unable to load band");
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
  }, [bandId]);

  if (loading) {
    return <LoadingState label="Loading band" />;
  }
  if (error) {
    return <ErrorState title="Band unavailable" message={error} />;
  }
  if (!band) {
    return <EmptyState message="Band not found." />;
  }

  const canManage = Boolean(band.version);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">{band.name}</h1>
        <p className="mt-1 text-sm text-neutral-600">{band.status}</p>
      </div>
      {actionError ? <ErrorState title="Action failed" message={actionError} /> : null}
      {canManage ? (
        <Card>
          <form
            className="space-y-3"
            onSubmit={(form: FormEvent) => {
              form.preventDefault();
              if (!band.version) {
                return;
              }
              void updateBand(band.id, { name, version: band.version })
                .then((row) => setBand(row))
                .catch((err: unknown) => {
                  setActionError(err instanceof ApiError ? err.message : "Save failed");
                });
            }}
          >
            <Input value={name} onChange={(e) => setName(e.target.value)} />
            <Button type="submit" size="sm">
              Save
            </Button>
          </form>
        </Card>
      ) : null}
      {canManage ? (
        <Card>
          <h2 className="text-sm font-medium">Lifecycle</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {["activate", "pause", "resume", "disband"].map((action) => (
              <Button
                key={action}
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  void transitionBand(band.id, action, band.version)
                    .then((row) => setBand(row))
                    .catch((err: unknown) => {
                      setActionError(err instanceof ApiError ? err.message : "Action failed");
                    });
                }}
              >
                {action}
              </Button>
            ))}
          </div>
        </Card>
      ) : null}
      <Card>
        <h2 className="text-sm font-medium">Members</h2>
        <p className="mt-1 text-xs text-neutral-600">
          Role label is free text, not a royalty share and not an instrument catalog.
        </p>
        {canManage ? (
          <form
            className="mt-3 space-y-2"
            onSubmit={(form: FormEvent) => {
              form.preventDefault();
              void inviteBandMember(band.id, memberUserId, roleLabel || undefined)
                .then(async () => {
                  const memberPage = await fetchBandMembers(band.id);
                  setMembers(memberPage.items);
                  setMemberUserId("");
                  setRoleLabel("");
                })
                .catch((err: unknown) => {
                  setActionError(err instanceof ApiError ? err.message : "Invite failed");
                });
            }}
          >
            <Input
              value={memberUserId}
              onChange={(e) => setMemberUserId(e.target.value)}
              placeholder="User id"
              required
            />
            <Input
              value={roleLabel}
              onChange={(e) => setRoleLabel(e.target.value)}
              placeholder="Role label (optional)"
            />
            <Button type="submit" size="sm">
              Invite
            </Button>
          </form>
        ) : null}
        {members.length === 0 ? (
          <EmptyState message="No members listed." />
        ) : (
          <ul className="mt-3 space-y-2 text-sm">
            {members.map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-2">
                <span>
                  {row.user_id ?? row.artist_id} · {row.status}
                  {row.role_label ? ` · ${row.role_label}` : ""}
                </span>
                {canManage && row.status !== "REMOVED" && row.status !== "LEFT" ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      void transitionBandMember(band.id, row.id, "remove")
                        .then(async () => {
                          const memberPage = await fetchBandMembers(band.id);
                          setMembers(memberPage.items);
                        })
                        .catch((err: unknown) => {
                          setActionError(err instanceof ApiError ? err.message : "Remove failed");
                        });
                    }}
                  >
                    Remove
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

export default function BandDetailPage() {
  return <BandDetailBody />;
}
