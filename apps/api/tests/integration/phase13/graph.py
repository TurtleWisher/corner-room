"""Phase 13 QA fixture graph — composition of existing factories/seed, not a second framework.

Layer order: infrastructure → orgs → users/memberships/roles → domain entities.
Smoke tests stop at layer 3 (no consumers). Derived notify/search/analytics state is
created only by event → outbox → consumer tests.

Constructing RELEASED/ACTIVE/PUBLISHED rows here is a fixture shortcut so the graph can
be built without replaying every owning-domain lifecycle test.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from cornerroom.infra.seed import seed_foundation
from cornerroom.infra.settings import Settings
from cornerroom.kernel.events import DomainEvent
from cornerroom.modules.artists.domain.models import Artist, Band, BandMember
from cornerroom.modules.authorization.domain.models import Role, RoleAssignment, RolePermission
from cornerroom.modules.campaigns.domain.models import Campaign
from cornerroom.modules.events.domain.models import Event, Venue
from cornerroom.modules.identity.domain.models import Organization, OrganizationMembership, User
from cornerroom.modules.music.domain.models import Release, ReleaseTrack, Track
from tests.factories import assign_role, create_org, create_user

P13_TEST_PASSWORD = "P13_TEST_PASSWORD"
P13_BASE_TIME = datetime(2026, 9, 10, 12, 0, 0, tzinfo=timezone.utc)

EMAIL_USER_A = "qa.p13.user.a@example.com"
EMAIL_USER_B = "qa.p13.user.b@example.com"
EMAIL_ANALYST_A = "qa.p13.analyst.a@example.com"
EMAIL_MARKETING_A = "qa.p13.marketing.a@example.com"


@dataclass
class Phase13Graph:
    org_a: Organization
    org_b: Organization
    user_a: User
    user_b: User
    analyst_a: User
    marketing_a: User
    artist_a: Artist
    artist_b: Artist
    artist_private_a: Artist
    band_a: Band
    release_a: Release
    release_b: Release
    track_a: Track
    track_b: Track
    event_a: Event
    event_b: Event
    campaign_a: Campaign
    campaign_b: Campaign
    venue_a: Venue


class FrozenClock:
    """Deterministic clock for ingest/delivery tests. Do not use datetime.now() in assertions."""

    def __init__(self, when: datetime = P13_BASE_TIME) -> None:
        self._when = when

    def now(self) -> datetime:
        return self._when


def p13_time(*, minutes: int = 0) -> datetime:
    return P13_BASE_TIME + timedelta(minutes=minutes)


async def _membership(
    session: AsyncSession, *, org: Organization, user: User
) -> OrganizationMembership:
    row = OrganizationMembership(
        organization_id=org.id,
        user_id=user.id,
        status="ACTIVE",
    )
    session.add(row)
    await session.flush()
    return row


async def _assign_org_role(
    session: AsyncSession, *, user: User, org: Organization, role_key: str
) -> RoleAssignment:
    assignment = await assign_role(session, user.id, role_key)
    assignment.organization_id = org.id
    await session.flush()
    return assignment


async def role_permission_keys(session: AsyncSession, role_key: str) -> set[str]:
    role = (await session.execute(select(Role).where(Role.key == role_key))).scalar_one()
    rows = (
        (await session.execute(select(RolePermission).where(RolePermission.role_id == role.id)))
        .scalars()
        .all()
    )
    from cornerroom.modules.authorization.domain.models import Permission

    keys: set[str] = set()
    for row in rows:
        perm = await session.get(Permission, row.permission_id)
        assert perm is not None
        keys.add(perm.key)
    return keys


async def membership_org_id(session: AsyncSession, user_id: UUID, org_id: UUID) -> UUID:
    row = (
        await session.execute(
            select(OrganizationMembership).where(
                OrganizationMembership.user_id == user_id,
                OrganizationMembership.organization_id == org_id,
                OrganizationMembership.status == "ACTIVE",
            )
        )
    ).scalar_one()
    return row.organization_id


async def build_phase13_graph(session: AsyncSession, settings: Settings) -> Phase13Graph:
    """Layers 0–3 only. Does not run notification/search/analytics consumers."""
    await seed_foundation(session, settings)

    org_a = await create_org(session, name="QA_P13_ORG_A", org_type="LABEL", status="ACTIVE")
    org_b = await create_org(session, name="QA_P13_ORG_B", org_type="LABEL", status="ACTIVE")

    user_a = await create_user(
        session, email=EMAIL_USER_A, password=P13_TEST_PASSWORD, display_name="QA_USER_A"
    )
    user_b = await create_user(
        session, email=EMAIL_USER_B, password=P13_TEST_PASSWORD, display_name="QA_USER_B"
    )
    analyst_a = await create_user(
        session, email=EMAIL_ANALYST_A, password=P13_TEST_PASSWORD, display_name="QA_ANALYST_A"
    )
    marketing_a = await create_user(
        session,
        email=EMAIL_MARKETING_A,
        password=P13_TEST_PASSWORD,
        display_name="QA_MARKETING_A",
    )

    await _membership(session, org=org_a, user=user_a)
    await _membership(session, org=org_b, user=user_b)
    await _membership(session, org=org_a, user=analyst_a)
    await _membership(session, org=org_a, user=marketing_a)
    await _assign_org_role(session, user=analyst_a, org=org_a, role_key="analyst")
    await _assign_org_role(session, user=marketing_a, org=org_a, role_key="marketing_manager")

    artist_a = Artist(
        stage_name="QA_P13_ARTIST_A",
        bio="Public artist A",
        status="ACTIVE",
        primary_org_id=org_a.id,
    )
    artist_b = Artist(
        stage_name="QA_P13_ARTIST_B",
        bio="Public artist B",
        status="ACTIVE",
        primary_org_id=org_b.id,
    )
    artist_private_a = Artist(
        stage_name="QA_P13_ARTIST_PRIVATE_A",
        bio="Draft artist A",
        status="APPLIED",
        primary_org_id=org_a.id,
    )
    session.add_all([artist_a, artist_b, artist_private_a])
    await session.flush()

    band_a = Band(name="QA_P13_BAND_A", status="ACTIVE", primary_org_id=org_a.id, bio="Band A")
    session.add(band_a)
    await session.flush()
    session.add(
        BandMember(band_id=band_a.id, artist_id=artist_a.id, status="ACTIVE", role_label="vocal")
    )

    release_a = Release(
        release_type="SINGLE",
        title="QA_P13_RELEASE_A",
        primary_artist_id=artist_a.id,
        status="RELEASED",
        primary_org_id=org_a.id,
        release_at=P13_BASE_TIME,
    )
    release_b = Release(
        release_type="SINGLE",
        title="QA_P13_RELEASE_B",
        primary_artist_id=artist_b.id,
        status="RELEASED",
        primary_org_id=org_b.id,
        release_at=P13_BASE_TIME,
    )
    session.add_all([release_a, release_b])
    await session.flush()

    track_a = Track(
        title="QA_P13_TRACK_A",
        status="RELEASED",
        primary_artist_id=artist_a.id,
        primary_org_id=org_a.id,
    )
    track_b = Track(
        title="QA_P13_TRACK_B",
        status="RELEASED",
        primary_artist_id=artist_b.id,
        primary_org_id=org_b.id,
    )
    session.add_all([track_a, track_b])
    await session.flush()
    session.add(ReleaseTrack(release_id=release_a.id, track_id=track_a.id, position=1))
    session.add(ReleaseTrack(release_id=release_b.id, track_id=track_b.id, position=1))

    venue_a = Venue(
        organization_id=org_a.id,
        name="QA_P13_VENUE_A",
        status="ACTIVE",
        capacity=100,
    )
    session.add(venue_a)
    await session.flush()

    event_a = Event(
        organization_id=org_a.id,
        venue_id=venue_a.id,
        title="QA_P13_EVENT_A",
        status="PUBLISHED",
        timezone="Asia/Dhaka",
        starts_at=p13_time(minutes=60),
        ends_at=p13_time(minutes=180),
        published_at=P13_BASE_TIME,
    )
    event_b = Event(
        organization_id=org_b.id,
        title="QA_P13_EVENT_B",
        status="PUBLISHED",
        timezone="Asia/Dhaka",
        starts_at=p13_time(minutes=60),
        ends_at=p13_time(minutes=180),
        published_at=P13_BASE_TIME,
    )
    session.add_all([event_a, event_b])

    campaign_a = Campaign(
        organization_id=org_a.id,
        title="QA_P13_CAMPAIGN_A",
        status="ACTIVE",
        starts_at=P13_BASE_TIME,
        ends_at=p13_time(minutes=240),
    )
    campaign_b = Campaign(
        organization_id=org_b.id,
        title="QA_P13_CAMPAIGN_B",
        status="ACTIVE",
        starts_at=P13_BASE_TIME,
        ends_at=p13_time(minutes=240),
    )
    session.add_all([campaign_a, campaign_b])
    await session.flush()

    return Phase13Graph(
        org_a=org_a,
        org_b=org_b,
        user_a=user_a,
        user_b=user_b,
        analyst_a=analyst_a,
        marketing_a=marketing_a,
        artist_a=artist_a,
        artist_b=artist_b,
        artist_private_a=artist_private_a,
        band_a=band_a,
        release_a=release_a,
        release_b=release_b,
        track_a=track_a,
        track_b=track_b,
        event_a=event_a,
        event_b=event_b,
        campaign_a=campaign_a,
        campaign_b=campaign_b,
        venue_a=venue_a,
    )


def domain_event(
    *,
    event_type: str,
    producer: str,
    aggregate_type: str,
    aggregate_id: UUID,
    payload: dict,
    organization_id: UUID | None = None,
    actor_id: UUID | None = None,
    occurred_at: datetime | None = None,
    correlation_id: str | None = "qa-p13-correlation",
) -> DomainEvent:
    return DomainEvent(
        event_type=event_type,
        producer=producer,
        aggregate_type=aggregate_type,
        aggregate_id=aggregate_id,
        payload=payload,
        occurred_at=occurred_at or P13_BASE_TIME,
        actor_id=actor_id,
        organization_id=organization_id,
        correlation_id=correlation_id,
    )
