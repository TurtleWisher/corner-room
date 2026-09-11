"""Deterministic integer royalty allocation. No hardcoded rates or residual payee."""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from cornerroom.infra.errors import AppError
from cornerroom.modules.royalties.domain.lifecycle import BPS_TOTAL


@dataclass(frozen=True, slots=True)
class ShareSlice:
    right_share_id: UUID
    rights_id: UUID
    right_type: str
    payee_type: str
    payee_id: UUID
    share_bps: int


@dataclass(frozen=True, slots=True)
class ResidualPayee:
    rights_id: UUID
    payee_type: str
    payee_id: UUID
    right_type: str


@dataclass(frozen=True, slots=True)
class LineDraft:
    rights_id: UUID
    right_share_id: UUID | None
    right_type: str
    payee_type: str
    payee_id: UUID
    track_id: UUID | None
    eligible_units: int
    share_bps_snapshot: int
    amount_minor: int
    is_residual: bool = False


def validate_share_coverage(
    share_bps: list[int],
    residual: ResidualPayee | None,
) -> int:
    if any(bps < 0 for bps in share_bps):
        raise AppError("INVALID_SHARE", "Share cannot be negative", 422)
    if any(bps > BPS_TOTAL for bps in share_bps):
        raise AppError("INVALID_SHARE", "Share cannot exceed 10000 bps", 422)
    total = sum(share_bps)
    if residual is None:
        if total != BPS_TOTAL:
            raise AppError(
                "SHARE_COVERAGE",
                "Shares must total 10000 bps when no residual payee is stored",
                409,
                f"share_bps sum is {total}; residual payee is required for the remainder",
            )
        return 0
    if total > BPS_TOTAL:
        raise AppError(
            "SHARE_COVERAGE",
            "Shares plus residual cannot exceed 10000 bps",
            409,
            f"share_bps sum is {total}",
        )
    return BPS_TOTAL - total


def largest_remainder(pool_minor: int, weights: dict[UUID, int]) -> tuple[dict[UUID, int], int]:
    """Allocate integer minor units by weight. Remainder stays unallocated if weights are empty."""
    if pool_minor < 0:
        raise AppError("INVALID_AMOUNT", "Pool amount cannot be negative", 422)
    total_weight = sum(weights.values())
    if pool_minor == 0 or total_weight <= 0:
        return {key: 0 for key in weights}, pool_minor
    floors: dict[UUID, int] = {}
    remainders: list[tuple[int, UUID]] = []
    allocated = 0
    for key, weight in weights.items():
        raw = pool_minor * weight
        floor = raw // total_weight
        floors[key] = floor
        allocated += floor
        remainders.append((raw % total_weight, key))
    leftover = pool_minor - allocated
    remainders.sort(key=lambda item: (-item[0], str(item[1])))
    for i in range(leftover):
        floors[remainders[i][1]] += 1
        allocated += 1
    return floors, pool_minor - allocated


def allocate_track_shares(
    *,
    track_id: UUID,
    track_amount_minor: int,
    eligible_units: int,
    shares: list[ShareSlice],
    residual: ResidualPayee | None,
) -> tuple[list[LineDraft], int]:
    if not shares and residual is None:
        raise AppError(
            "NO_VALID_SHARE",
            "No valid RightShare for this work",
            409,
            "Fail closed: Credit, BandMember, and primary_org_id are not shares",
        )
    residual_bps = validate_share_coverage([row.share_bps for row in shares], residual)
    lines: list[LineDraft] = []
    used = 0
    for share in shares:
        amount = (track_amount_minor * share.share_bps) // BPS_TOTAL
        used += amount
        if amount == 0 and share.share_bps == 0:
            continue
        lines.append(
            LineDraft(
                rights_id=share.rights_id,
                right_share_id=share.right_share_id,
                right_type=share.right_type,
                payee_type=share.payee_type,
                payee_id=share.payee_id,
                track_id=track_id,
                eligible_units=eligible_units,
                share_bps_snapshot=share.share_bps,
                amount_minor=amount,
            )
        )
    remainder = track_amount_minor - used
    if remainder > 0:
        if residual is None or residual_bps <= 0:
            return lines, remainder
        lines.append(
            LineDraft(
                rights_id=residual.rights_id,
                right_share_id=None,
                right_type=residual.right_type,
                payee_type=residual.payee_type,
                payee_id=residual.payee_id,
                track_id=track_id,
                eligible_units=eligible_units,
                share_bps_snapshot=residual_bps,
                amount_minor=remainder,
                is_residual=True,
            )
        )
        remainder = 0
    return lines, remainder


def allocate_pool(
    *,
    pool_minor: int,
    units_by_track: dict[UUID, int],
    shares_by_track: dict[UUID, list[ShareSlice]],
    residual_by_track: dict[UUID, ResidualPayee | None],
) -> tuple[list[LineDraft], int, dict[UUID, int], dict[UUID, int]]:
    """Return lines, unallocated_minor, payable_units, non_payable_units."""
    payable: dict[UUID, int] = {}
    non_payable: dict[UUID, int] = {}
    for track_id, units in units_by_track.items():
        shares = shares_by_track.get(track_id) or []
        residual = residual_by_track.get(track_id)
        try:
            if not shares and residual is None:
                raise AppError("NO_VALID_SHARE", "No valid RightShare", 409)
            validate_share_coverage([row.share_bps for row in shares], residual)
        except AppError:
            non_payable[track_id] = units
            continue
        payable[track_id] = units
    amounts, leftover = largest_remainder(pool_minor, {**payable, **non_payable})
    lines: list[LineDraft] = []
    unallocated = leftover
    for track_id, amount in amounts.items():
        if track_id in non_payable:
            unallocated += amount
            continue
        track_lines, rem = allocate_track_shares(
            track_id=track_id,
            track_amount_minor=amount,
            eligible_units=payable[track_id],
            shares=shares_by_track.get(track_id) or [],
            residual=residual_by_track.get(track_id),
        )
        lines.extend(track_lines)
        unallocated += rem
    return lines, unallocated, payable, non_payable
