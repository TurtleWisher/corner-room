"""RBAC decision unit tests — no database."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import uuid4

from cornerroom.kernel.authorize import (
    MembershipView,
    ResourceGrantView,
    RolePermissionView,
    decide_authorize,
)

NOW = datetime(2026, 9, 6, tzinfo=timezone.utc)


def test_deny_by_default() -> None:
    user_id = uuid4()
    assert (
        decide_authorize(
            permission="audit.read",
            now=NOW,
            assignments=[],
            grants=[],
            memberships=[],
            user_id=user_id,
        )
        is False
    )


def test_unscoped_role_permission() -> None:
    user_id = uuid4()
    assignments = [
        RolePermissionView(
            permission_key="audit.read",
            organization_id=None,
            expires_at=None,
            assignment_status="ACTIVE",
        )
    ]
    assert (
        decide_authorize(
            permission="audit.read",
            now=NOW,
            assignments=assignments,
            grants=[],
            memberships=[],
            user_id=user_id,
        )
        is True
    )


def test_expired_assignment_denied() -> None:
    user_id = uuid4()
    assignments = [
        RolePermissionView(
            permission_key="org.admin",
            organization_id=None,
            expires_at=NOW - timedelta(seconds=1),
            assignment_status="ACTIVE",
        )
    ]
    assert (
        decide_authorize(
            permission="org.admin",
            now=NOW,
            assignments=assignments,
            grants=[],
            memberships=[],
            user_id=user_id,
        )
        is False
    )


def test_wrong_resource_denied() -> None:
    user_id = uuid4()
    org_a, org_b = uuid4(), uuid4()
    grants = [
        ResourceGrantView(
            permission_key="org.admin",
            principal_type="user",
            principal_id=user_id,
            resource_type="organization",
            resource_id=org_a,
            status="ACTIVE",
            expires_at=None,
        )
    ]
    assert (
        decide_authorize(
            permission="org.admin",
            now=NOW,
            assignments=[],
            grants=grants,
            memberships=[],
            user_id=user_id,
            resource_type="organization",
            resource_id=org_b,
        )
        is False
    )
    assert (
        decide_authorize(
            permission="org.admin",
            now=NOW,
            assignments=[],
            grants=grants,
            memberships=[],
            user_id=user_id,
            resource_type="organization",
            resource_id=org_a,
        )
        is True
    )


def test_owner_shortcut() -> None:
    user_id = uuid4()
    assignments = [
        RolePermissionView(
            permission_key="audit.read",
            organization_id=None,
            expires_at=None,
            assignment_status="ACTIVE",
        )
    ]
    assert (
        decide_authorize(
            permission="audit.read",
            now=NOW,
            assignments=assignments,
            grants=[],
            memberships=[],
            user_id=user_id,
            resource_type="document",
            resource_id=uuid4(),
            owner_user_id=user_id,
        )
        is True
    )
    assert (
        decide_authorize(
            permission="audit.read",
            now=NOW,
            assignments=[],
            grants=[],
            memberships=[],
            user_id=user_id,
            resource_type="document",
            resource_id=uuid4(),
            owner_user_id=user_id,
        )
        is False
    )


def test_artist_resource_denied_without_grant() -> None:
    user_id = uuid4()
    assignments = [
        RolePermissionView(
            permission_key="artist.manage",
            organization_id=None,
            expires_at=None,
            assignment_status="ACTIVE",
        )
    ]
    assert (
        decide_authorize(
            permission="artist.manage",
            now=NOW,
            assignments=assignments,
            grants=[],
            memberships=[],
            user_id=user_id,
            resource_type="artist",
            resource_id=uuid4(),
        )
        is False
    )


def test_artist_owner_claim_allows_manage() -> None:
    user_id = uuid4()
    artist_id = uuid4()
    assert (
        decide_authorize(
            permission="artist.manage",
            now=NOW,
            assignments=[],
            grants=[],
            memberships=[],
            user_id=user_id,
            resource_type="artist",
            resource_id=artist_id,
            owner_user_id=user_id,
        )
        is True
    )
    assert (
        decide_authorize(
            permission="artist.manage",
            now=NOW,
            assignments=[],
            grants=[],
            memberships=[],
            user_id=user_id,
            resource_type="artist",
            resource_id=artist_id,
            owner_user_id=uuid4(),
        )
        is False
    )


def test_artist_org_scoped_label_manager() -> None:
    user_id = uuid4()
    org_a, org_b = uuid4(), uuid4()
    artist_a, artist_b = uuid4(), uuid4()
    assignments = [
        RolePermissionView(
            permission_key="artist.manage",
            organization_id=org_a,
            expires_at=None,
            assignment_status="ACTIVE",
        )
    ]
    assert (
        decide_authorize(
            permission="artist.manage",
            now=NOW,
            assignments=assignments,
            grants=[],
            memberships=[],
            user_id=user_id,
            resource_type="artist",
            resource_id=artist_a,
            scope_organization_id=org_a,
        )
        is True
    )
    assert (
        decide_authorize(
            permission="artist.manage",
            now=NOW,
            assignments=assignments,
            grants=[],
            memberships=[],
            user_id=user_id,
            resource_type="artist",
            resource_id=artist_b,
            scope_organization_id=org_b,
        )
        is False
    )


def test_artist_resource_grant() -> None:
    user_id = uuid4()
    artist_id = uuid4()
    grants = [
        ResourceGrantView(
            permission_key="artist.manage",
            principal_type="user",
            principal_id=user_id,
            resource_type="artist",
            resource_id=artist_id,
            status="ACTIVE",
            expires_at=None,
        )
    ]
    assert (
        decide_authorize(
            permission="artist.manage",
            now=NOW,
            assignments=[],
            grants=grants,
            memberships=[],
            user_id=user_id,
            resource_type="artist",
            resource_id=artist_id,
            scope_organization_id=uuid4(),
        )
        is True
    )


def test_no_wildcard_star() -> None:
    user_id = uuid4()
    assignments = [
        RolePermissionView(
            permission_key="*",
            organization_id=None,
            expires_at=None,
            assignment_status="ACTIVE",
        )
    ]
    assert (
        decide_authorize(
            permission="audit.read",
            now=NOW,
            assignments=assignments,
            grants=[],
            memberships=[],
            user_id=user_id,
        )
        is False
    )


def test_org_scoped_assignment_does_not_leak_globally() -> None:
    user_id = uuid4()
    org_a, org_b = uuid4(), uuid4()
    assignments = [
        RolePermissionView(
            permission_key="org.admin",
            organization_id=org_a,
            expires_at=None,
            assignment_status="ACTIVE",
        )
    ]
    assert (
        decide_authorize(
            permission="org.admin",
            now=NOW,
            assignments=assignments,
            grants=[],
            memberships=[],
            user_id=user_id,
        )
        is False
    )
    assert (
        decide_authorize(
            permission="org.admin",
            now=NOW,
            assignments=assignments,
            grants=[],
            memberships=[],
            user_id=user_id,
            resource_type="organization",
            resource_id=org_a,
        )
        is True
    )
    assert (
        decide_authorize(
            permission="org.admin",
            now=NOW,
            assignments=assignments,
            grants=[],
            memberships=[],
            user_id=user_id,
            resource_type="organization",
            resource_id=org_b,
        )
        is False
    )


def test_org_membership_with_capability() -> None:
    user_id = uuid4()
    org_id = uuid4()
    assignments = [
        RolePermissionView(
            permission_key="org.admin",
            organization_id=None,
            expires_at=None,
            assignment_status="ACTIVE",
        )
    ]
    memberships = [MembershipView(organization_id=org_id, user_id=user_id, status="ACTIVE")]
    assert (
        decide_authorize(
            permission="org.admin",
            now=NOW,
            assignments=assignments,
            grants=[],
            memberships=memberships,
            user_id=user_id,
            resource_type="organization",
            resource_id=org_id,
        )
        is True
    )


def test_event_org_scoped_permission() -> None:
    user_id = uuid4()
    org_a, org_b = uuid4(), uuid4()
    event_a, event_b = uuid4(), uuid4()
    assignments = [
        RolePermissionView(
            permission_key="event.write",
            organization_id=org_a,
            expires_at=None,
            assignment_status="ACTIVE",
        )
    ]
    assert (
        decide_authorize(
            permission="event.write",
            now=NOW,
            assignments=assignments,
            grants=[],
            memberships=[],
            user_id=user_id,
            resource_type="event",
            resource_id=event_a,
            scope_organization_id=org_a,
        )
        is True
    )
    assert (
        decide_authorize(
            permission="event.write",
            now=NOW,
            assignments=assignments,
            grants=[],
            memberships=[],
            user_id=user_id,
            resource_type="event",
            resource_id=event_b,
            scope_organization_id=org_b,
        )
        is False
    )


def test_event_read_via_membership() -> None:
    user_id = uuid4()
    org_id = uuid4()
    event_id = uuid4()
    memberships = [MembershipView(organization_id=org_id, user_id=user_id, status="ACTIVE")]
    assert (
        decide_authorize(
            permission="event.read",
            now=NOW,
            assignments=[],
            grants=[],
            memberships=memberships,
            user_id=user_id,
            resource_type="event",
            resource_id=event_id,
            scope_organization_id=org_id,
        )
        is True
    )
    assert (
        decide_authorize(
            permission="event.write",
            now=NOW,
            assignments=[],
            grants=[],
            memberships=memberships,
            user_id=user_id,
            resource_type="event",
            resource_id=event_id,
            scope_organization_id=org_id,
        )
        is False
    )


def test_event_resource_grant() -> None:
    user_id = uuid4()
    event_id = uuid4()
    grants = [
        ResourceGrantView(
            permission_key="event.write",
            principal_type="user",
            principal_id=user_id,
            resource_type="event",
            resource_id=event_id,
            status="ACTIVE",
            expires_at=None,
        )
    ]
    assert (
        decide_authorize(
            permission="event.write",
            now=NOW,
            assignments=[],
            grants=grants,
            memberships=[],
            user_id=user_id,
            resource_type="event",
            resource_id=event_id,
            scope_organization_id=uuid4(),
        )
        is True
    )


def test_campaign_org_scoped_write() -> None:
    user_id = uuid4()
    org_a, org_b = uuid4(), uuid4()
    campaign_a, campaign_b = uuid4(), uuid4()
    assignments = [
        RolePermissionView(
            permission_key="campaign.write",
            organization_id=org_a,
            expires_at=None,
            assignment_status="ACTIVE",
        )
    ]
    assert (
        decide_authorize(
            permission="campaign.write",
            now=NOW,
            assignments=assignments,
            grants=[],
            memberships=[],
            user_id=user_id,
            resource_type="campaign",
            resource_id=campaign_a,
            scope_organization_id=org_a,
        )
        is True
    )
    assert (
        decide_authorize(
            permission="campaign.write",
            now=NOW,
            assignments=assignments,
            grants=[],
            memberships=[],
            user_id=user_id,
            resource_type="campaign",
            resource_id=campaign_b,
            scope_organization_id=org_b,
        )
        is False
    )
    assert (
        decide_authorize(
            permission="campaign.write",
            now=NOW,
            assignments=[],
            grants=[],
            memberships=[MembershipView(organization_id=org_a, user_id=user_id, status="ACTIVE")],
            user_id=user_id,
            resource_type="campaign",
            resource_id=campaign_a,
            scope_organization_id=org_a,
        )
        is False
    )


def test_track_org_scoped_permission() -> None:
    user_id = uuid4()
    org_a, org_b = uuid4(), uuid4()
    track_a, track_b = uuid4(), uuid4()
    assignments = [
        RolePermissionView(
            permission_key="music.write",
            organization_id=org_a,
            expires_at=None,
            assignment_status="ACTIVE",
        )
    ]
    assert (
        decide_authorize(
            permission="music.write",
            now=NOW,
            assignments=assignments,
            grants=[],
            memberships=[],
            user_id=user_id,
            resource_type="track",
            resource_id=track_a,
            scope_organization_id=org_a,
        )
        is True
    )
    assert (
        decide_authorize(
            permission="music.write",
            now=NOW,
            assignments=assignments,
            grants=[],
            memberships=[],
            user_id=user_id,
            resource_type="track",
            resource_id=track_b,
            scope_organization_id=org_b,
        )
        is False
    )


def test_track_owner_write_not_approve() -> None:
    user_id = uuid4()
    track_id = uuid4()
    assert (
        decide_authorize(
            permission="music.write",
            now=NOW,
            assignments=[],
            grants=[],
            memberships=[],
            user_id=user_id,
            resource_type="track",
            resource_id=track_id,
            owner_user_id=user_id,
            scope_organization_id=uuid4(),
        )
        is True
    )
    assert (
        decide_authorize(
            permission="music.approve",
            now=NOW,
            assignments=[],
            grants=[],
            memberships=[],
            user_id=user_id,
            resource_type="track",
            resource_id=track_id,
            owner_user_id=user_id,
            scope_organization_id=uuid4(),
        )
        is False
    )


def test_release_resource_grant() -> None:
    user_id = uuid4()
    release_id = uuid4()
    grants = [
        ResourceGrantView(
            permission_key="music.approve",
            principal_type="user",
            principal_id=user_id,
            resource_type="release",
            resource_id=release_id,
            status="ACTIVE",
            expires_at=None,
        )
    ]
    assert (
        decide_authorize(
            permission="music.approve",
            now=NOW,
            assignments=[],
            grants=grants,
            memberships=[],
            user_id=user_id,
            resource_type="release",
            resource_id=release_id,
            scope_organization_id=uuid4(),
        )
        is True
    )


def test_artist_owner_can_read_own_play_aggregates() -> None:
    user_id = uuid4()
    artist_id = uuid4()
    assert (
        decide_authorize(
            permission="analytics.read",
            now=NOW,
            assignments=[],
            grants=[],
            memberships=[],
            user_id=user_id,
            resource_type="artist",
            resource_id=artist_id,
            owner_user_id=user_id,
            scope_organization_id=uuid4(),
        )
        is True
    )
    assert (
        decide_authorize(
            permission="analytics.read",
            now=NOW,
            assignments=[],
            grants=[],
            memberships=[],
            user_id=user_id,
            resource_type="artist",
            resource_id=artist_id,
            owner_user_id=uuid4(),
            scope_organization_id=uuid4(),
        )
        is False
    )


def test_royalty_run_is_org_scoped() -> None:
    user_id = uuid4()
    org_a = uuid4()
    org_b = uuid4()
    pool_a = uuid4()
    assignments = [
        RolePermissionView(
            permission_key="royalty.run",
            organization_id=org_a,
            expires_at=None,
            assignment_status="ACTIVE",
        )
    ]
    assert (
        decide_authorize(
            permission="royalty.run",
            now=NOW,
            assignments=assignments,
            grants=[],
            memberships=[],
            user_id=user_id,
            resource_type="revenue_pool",
            resource_id=pool_a,
            scope_organization_id=org_a,
        )
        is True
    )
    assert (
        decide_authorize(
            permission="royalty.run",
            now=NOW,
            assignments=assignments,
            grants=[],
            memberships=[],
            user_id=user_id,
            resource_type="revenue_pool",
            resource_id=pool_a,
            scope_organization_id=org_b,
        )
        is False
    )
