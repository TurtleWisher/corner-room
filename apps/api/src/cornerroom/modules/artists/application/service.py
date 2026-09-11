"""Artist and band application service. Controllers stay thin. No catalog or money."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import Select, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.exc import StaleDataError

from cornerroom.infra.errors import AppError, ConflictError, ForbiddenError, NotFoundError
from cornerroom.infra.outbox import enqueue_outbox
from cornerroom.kernel.auth_context import AuthContext
from cornerroom.kernel.clock import Clock, SystemClock
from cornerroom.kernel.events import (
    ARTIST_ACTIVATED,
    ARTIST_APPLICATION_SUBMITTED,
    ARTIST_FOLLOWED,
    ARTIST_SUSPENDED,
    ARTIST_UNFOLLOWED,
    BAND_MEMBER_CHANGED,
    DomainEvent,
)
from cornerroom.kernel.pagination import clamp_limit, decode_cursor, encode_cursor
from cornerroom.modules.artists.domain.lifecycle import (
    PUBLIC_ARTIST_STATUSES,
    PUBLIC_BAND_STATUSES,
    application_target_for_action,
    application_transition_action,
    artist_target_for_action,
    artist_transition_action,
    band_target_for_action,
    band_transition_action,
    member_target_for_action,
    member_transition_action,
)
from cornerroom.modules.artists.domain.models import (
    Artist,
    ArtistApplication,
    Band,
    BandMember,
    Follow,
)
from cornerroom.modules.audit.application.service import AuditService
from cornerroom.modules.authorization.application.service import AuthorizationService
from cornerroom.modules.documents.domain.models import MediaAsset
from cornerroom.modules.identity.domain.models import Organization, User

FLEXIBLE_META_KEYS = frozenset({"genres", "social_links"})


class ArtistService:
    def __init__(self, session: AsyncSession, clock: Clock | None = None) -> None:
        self.session = session
        self.clock = clock or SystemClock()
        self.audit = AuditService(session)
        self.authz = AuthorizationService(session, clock=self.clock)

    async def _org(self, org_id: UUID) -> Organization:
        org = await self.session.get(Organization, org_id)
        if org is None or org.deleted_at is not None:
            raise NotFoundError("Organization not found")
        return org

    async def _require_active_org(self, org_id: UUID) -> Organization:
        org = await self._org(org_id)
        if org.status != "ACTIVE":
            raise AppError(
                "ORG_NOT_ACTIVE",
                "Organization is not active",
                409,
                "Suspended or archived organizations cannot mutate artist roster",
            )
        return org

    def _workspace_org_id(self, ctx: AuthContext, claimed: UUID | None) -> UUID:
        if claimed is not None and ctx.organization_id is not None and claimed != ctx.organization_id:
            raise AppError(
                "ORG_SCOPE_MISMATCH",
                "organization_id does not match the active workspace",
                403,
                "Client organization_id cannot override the workspace",
            )
        org_id = ctx.organization_id
        if org_id is None:
            raise AppError(
                "WORKSPACE_REQUIRED",
                "Active organization workspace is required",
                409,
                "Switch to an organization before mutating roster resources",
            )
        return org_id

    async def _is_allowed(
        self,
        user_id: UUID,
        permission: str,
        *,
        resource_type: str,
        resource_id: UUID,
        organization_id: UUID | None,
        owner_user_id: UUID | None = None,
    ) -> bool:
        try:
            await self.authz.authorize(
                user_id,
                permission,
                resource_type=resource_type,
                resource_id=resource_id,
                owner_user_id=owner_user_id,
                scope_organization_id=organization_id,
            )
            return True
        except ForbiddenError:
            return False

    async def _assert_artist_perm(
        self,
        ctx: AuthContext,
        artist: Artist,
        permission: str,
        *,
        mutate: bool,
    ) -> None:
        allowed = await self._is_allowed(
            ctx.user_id,
            permission,
            resource_type="artist",
            resource_id=artist.id,
            organization_id=artist.primary_org_id,
            owner_user_id=artist.claimed_user_id,
        )
        if allowed:
            return
        if mutate:
            raise NotFoundError("Artist not found")
        raise NotFoundError("Artist not found")

    async def _assert_band_perm(
        self,
        ctx: AuthContext,
        band: Band,
        permission: str,
        *,
        mutate: bool,
    ) -> None:
        allowed = await self._is_allowed(
            ctx.user_id,
            permission,
            resource_type="band",
            resource_id=band.id,
            organization_id=band.primary_org_id,
        )
        if allowed:
            return
        if not mutate:
            member = await self._active_or_invited_member(band.id, ctx.user_id)
            if member is not None:
                return
        raise NotFoundError("Band not found")

    async def _can_staff_manage_workspace(self, ctx: AuthContext, org_id: UUID) -> bool:
        return await self._is_allowed(
            ctx.user_id,
            "artist.manage",
            resource_type="artist",
            resource_id=org_id,
            organization_id=org_id,
        )

    async def _flush_versioned(self) -> None:
        try:
            await self.session.flush()
        except StaleDataError as exc:
            raise ConflictError("The resource was updated concurrently") from exc
        except IntegrityError as exc:
            raise ConflictError("Conflicting artist or membership state") from exc

    def _meta(self, extra_metadata: dict[str, Any] | None) -> dict[str, Any] | None:
        if extra_metadata is None:
            return None
        cleaned = {k: v for k, v in extra_metadata.items() if k in FLEXIBLE_META_KEYS}
        return cleaned or None

    async def _portrait(self, asset_id: UUID | None) -> UUID | None:
        if asset_id is None:
            return None
        asset = await self.session.get(MediaAsset, asset_id)
        if asset is None or asset.deleted_at is not None:
            raise AppError("VALIDATION_ERROR", "Portrait media was not found", 422)
        if asset.storage_class in {"catalog_audio", "legal_document"}:
            raise AppError(
                "RESIDENCY_GATE",
                "Audio and identity documents are not allowed on artist profiles",
                403,
            )
        if asset.storage_class != "public_media":
            raise AppError("VALIDATION_ERROR", "Portrait must use public_media", 422)
        if asset.status != "READY":
            raise AppError("VALIDATION_ERROR", "Portrait upload is not ready", 422)
        return asset.id

    async def _emit(
        self,
        *,
        event_type: str,
        aggregate_type: str,
        aggregate_id: UUID,
        payload: dict[str, Any],
        ctx: AuthContext,
        organization_id: UUID | None,
    ) -> None:
        event = DomainEvent(
            event_type=event_type,
            producer="artists",
            aggregate_type=aggregate_type,
            aggregate_id=aggregate_id,
            payload=payload,
            occurred_at=self.clock.now(),
            actor_id=ctx.user_id,
            organization_id=organization_id,
            correlation_id=ctx.request_id,
        )
        await enqueue_outbox(self.session, event)

    async def get_artist_row(self, artist_id: UUID) -> Artist:
        artist = await self.session.get(Artist, artist_id)
        if artist is None or artist.deleted_at is not None:
            raise NotFoundError("Artist not found")
        return artist

    async def get_band_row(self, band_id: UUID) -> Band:
        band = await self.session.get(Band, band_id)
        if band is None or band.deleted_at is not None:
            raise NotFoundError("Band not found")
        return band

    async def submit_application(
        self,
        ctx: AuthContext,
        *,
        stage_name: str,
        legal_name: str | None = None,
        bio: str | None = None,
        extra_metadata: dict[str, Any] | None = None,
        payload: dict[str, Any] | None = None,
    ) -> tuple[ArtistApplication, Artist]:
        name = stage_name.strip()
        if not name:
            raise AppError("VALIDATION_ERROR", "Stage name is required", 422)
        existing_claim = (
            await self.session.execute(
                select(Artist).where(
                    Artist.claimed_user_id == ctx.user_id,
                    Artist.deleted_at.is_(None),
                )
            )
        ).scalar_one_or_none()
        if existing_claim is not None:
            raise ConflictError("This account already claims an artist")
        artist = Artist(
            claimed_user_id=ctx.user_id,
            stage_name=name,
            legal_name=legal_name.strip() if legal_name else None,
            bio=bio.strip() if bio else None,
            status="APPLIED",
            extra_metadata=self._meta(extra_metadata),
            created_by=ctx.user_id,
        )
        self.session.add(artist)
        await self.session.flush()
        application = ArtistApplication(
            user_id=ctx.user_id,
            artist_id=artist.id,
            status="SUBMITTED",
            payload=payload,
            created_by=ctx.user_id,
        )
        self.session.add(application)
        try:
            await self.session.flush()
        except IntegrityError as exc:
            raise ConflictError("An application is already outstanding") from exc
        await self._emit(
            event_type=ARTIST_APPLICATION_SUBMITTED,
            aggregate_type="ArtistApplication",
            aggregate_id=application.id,
            payload={"artist_id": str(artist.id), "status": "SUBMITTED"},
            ctx=ctx,
            organization_id=None,
        )
        await self.audit.record_from_auth(
            ctx,
            action="artist_application.submitted",
            entity_type="ArtistApplication",
            entity_id=application.id,
            new_state={"status": "SUBMITTED", "artist_id": str(artist.id)},
        )
        return application, artist

    async def create_artist(
        self,
        ctx: AuthContext,
        *,
        stage_name: str,
        legal_name: str | None = None,
        bio: str | None = None,
        extra_metadata: dict[str, Any] | None = None,
        portrait_asset_id: UUID | None = None,
        organization_id: UUID | None = None,
        claimed_user_id: UUID | None = None,
    ) -> Artist:
        org_id = self._workspace_org_id(ctx, organization_id)
        await self._require_active_org(org_id)
        if not await self._can_staff_manage_workspace(ctx, org_id):
            raise ForbiddenError("Missing permission artist.manage")
        name = stage_name.strip()
        if not name:
            raise AppError("VALIDATION_ERROR", "Stage name is required", 422)
        if claimed_user_id is not None:
            user = await self.session.get(User, claimed_user_id)
            if user is None or user.deleted_at is not None:
                raise AppError("VALIDATION_ERROR", "Claimed user was not found", 422)
        artist = Artist(
            claimed_user_id=claimed_user_id,
            stage_name=name,
            legal_name=legal_name.strip() if legal_name else None,
            bio=bio.strip() if bio else None,
            status="APPLIED",
            primary_org_id=org_id,
            portrait_asset_id=await self._portrait(portrait_asset_id),
            extra_metadata=self._meta(extra_metadata),
            created_by=ctx.user_id,
        )
        self.session.add(artist)
        try:
            await self.session.flush()
        except IntegrityError as exc:
            raise ConflictError("Claimed user already has an artist") from exc
        await self.audit.record_from_auth(
            ctx,
            action="artist.created",
            entity_type="Artist",
            entity_id=artist.id,
            new_state={
                "stage_name": artist.stage_name,
                "status": artist.status,
                "primary_org_id": str(org_id),
            },
            organization_id=org_id,
        )
        return artist

    def _is_public_artist(self, artist: Artist) -> bool:
        return artist.status in PUBLIC_ARTIST_STATUSES

    def _is_public_band(self, band: Band) -> bool:
        return band.status in PUBLIC_BAND_STATUSES

    async def get_artist(self, artist_id: UUID, ctx: AuthContext | None) -> tuple[Artist, bool]:
        artist = await self.get_artist_row(artist_id)
        public = self._is_public_artist(artist)
        if ctx is None:
            if not public:
                raise NotFoundError("Artist not found")
            return artist, True
        allowed = await self._is_allowed(
            ctx.user_id,
            "artist.manage",
            resource_type="artist",
            resource_id=artist.id,
            organization_id=artist.primary_org_id,
            owner_user_id=artist.claimed_user_id,
        )
        if allowed:
            return artist, False
        if public:
            return artist, True
        raise NotFoundError("Artist not found")

    async def list_artists(
        self,
        ctx: AuthContext | None,
        *,
        cursor: str | None = None,
        limit: int | None = None,
    ) -> tuple[list[Artist], str | None, bool]:
        page = clamp_limit(limit)
        stmt: Select[tuple[Artist]] = select(Artist).where(Artist.deleted_at.is_(None))
        public_only = True
        if ctx is not None and ctx.organization_id is not None:
            if await self._can_staff_manage_workspace(ctx, ctx.organization_id):
                public_only = False
                stmt = stmt.where(Artist.primary_org_id == ctx.organization_id)
        if public_only:
            stmt = stmt.where(Artist.status.in_(tuple(PUBLIC_ARTIST_STATUSES)))
        stmt = stmt.order_by(Artist.created_at.desc(), Artist.id.desc())
        if cursor:
            data = decode_cursor(cursor)
            stmt = stmt.where(Artist.created_at < data["t"])
        stmt = stmt.limit(page + 1)
        rows = list((await self.session.execute(stmt)).scalars().all())
        next_cursor = None
        if len(rows) > page:
            last = rows[page - 1]
            next_cursor = encode_cursor(last.created_at.isoformat(), last.id)
            rows = rows[:page]
        return rows, next_cursor, public_only

    async def update_artist(
        self,
        ctx: AuthContext,
        artist_id: UUID,
        *,
        stage_name: str | None = None,
        legal_name: str | None | object = ...,
        bio: str | None | object = ...,
        extra_metadata: dict[str, Any] | None | object = ...,
        portrait_asset_id: UUID | None | object = ...,
        expected_version: int | None = None,
    ) -> Artist:
        artist = await self.get_artist_row(artist_id)
        await self._assert_artist_perm(ctx, artist, "artist.manage", mutate=True)
        if artist.primary_org_id is not None:
            await self._require_active_org(artist.primary_org_id)
        if artist.status in {"TERMINATED", "REJECTED"}:
            raise AppError("INVALID_TRANSITION", "Artist cannot be edited in this state", 409)
        if expected_version is not None and artist.version != expected_version:
            raise ConflictError("Artist version conflict")
        previous = {"stage_name": artist.stage_name, "status": artist.status, "version": artist.version}
        if stage_name is not None:
            trimmed = stage_name.strip()
            if not trimmed:
                raise AppError("VALIDATION_ERROR", "Stage name is required", 422)
            artist.stage_name = trimmed
        if legal_name is not ...:
            artist.legal_name = legal_name.strip() if isinstance(legal_name, str) and legal_name else None
        if bio is not ...:
            artist.bio = bio.strip() if isinstance(bio, str) and bio else None
        if extra_metadata is not ...:
            artist.extra_metadata = self._meta(extra_metadata if isinstance(extra_metadata, dict) else None)
        if portrait_asset_id is not ...:
            artist.portrait_asset_id = await self._portrait(
                portrait_asset_id if isinstance(portrait_asset_id, UUID) else None
            )
        artist.updated_by = ctx.user_id
        await self._flush_versioned()
        await self.audit.record_from_auth(
            ctx,
            action="artist.updated",
            entity_type="Artist",
            entity_id=artist.id,
            previous_state=previous,
            new_state={"stage_name": artist.stage_name, "version": artist.version},
            organization_id=artist.primary_org_id,
        )
        return artist

    async def transition_artist(
        self,
        ctx: AuthContext,
        artist_id: UUID,
        *,
        action: str,
        expected_version: int | None = None,
    ) -> Artist:
        artist = await self.get_artist_row(artist_id)
        staff = await self._is_allowed(
            ctx.user_id,
            "artist.manage",
            resource_type="artist",
            resource_id=artist.id,
            organization_id=artist.primary_org_id or ctx.organization_id,
        )
        if not staff:
            raise NotFoundError("Artist not found")
        if artist.primary_org_id is not None:
            await self._require_active_org(artist.primary_org_id)
        elif action != "start_review":
            org_id = ctx.organization_id
            if org_id is None or not await self._can_staff_manage_workspace(ctx, org_id):
                raise NotFoundError("Artist not found")
        if expected_version is not None and artist.version != expected_version:
            raise ConflictError("Artist version conflict")
        target = artist_target_for_action(action)
        previous = artist.status
        artist_transition_action(previous, target)
        artist.status = target
        artist.updated_by = ctx.user_id
        if action == "approve" and artist.primary_org_id is None and ctx.organization_id is not None:
            await self._require_active_org(ctx.organization_id)
            artist.primary_org_id = ctx.organization_id
        await self._flush_versioned()
        if action == "approve" and artist.claimed_user_id is not None:
            await self.authz.grant_resource(
                principal_type="user",
                principal_id=artist.claimed_user_id,
                permission_key="artist.manage",
                resource_type="artist",
                resource_id=artist.id,
                ctx=ctx,
            )
        if action == "activate":
            await self._emit(
                event_type=ARTIST_ACTIVATED,
                aggregate_type="Artist",
                aggregate_id=artist.id,
                payload={"status": artist.status, "previous_status": previous},
                ctx=ctx,
                organization_id=artist.primary_org_id,
            )
        if action == "suspend":
            await self._emit(
                event_type=ARTIST_SUSPENDED,
                aggregate_type="Artist",
                aggregate_id=artist.id,
                payload={"status": artist.status, "previous_status": previous},
                ctx=ctx,
                organization_id=artist.primary_org_id,
            )
        await self.audit.record_from_auth(
            ctx,
            action=f"artist.{action}",
            entity_type="Artist",
            entity_id=artist.id,
            previous_state={"status": previous},
            new_state={"status": artist.status},
            organization_id=artist.primary_org_id,
        )
        return artist

    async def get_application_row(self, application_id: UUID) -> ArtistApplication:
        row = await self.session.get(ArtistApplication, application_id)
        if row is None or row.deleted_at is not None:
            raise NotFoundError("Application not found")
        return row

    async def list_applications(
        self,
        ctx: AuthContext,
        *,
        cursor: str | None = None,
        limit: int | None = None,
        mine: bool = False,
    ) -> tuple[list[ArtistApplication], str | None]:
        page = clamp_limit(limit)
        stmt: Select[tuple[ArtistApplication]] = select(ArtistApplication).where(
            ArtistApplication.deleted_at.is_(None)
        )
        staff = False
        if ctx.organization_id is not None:
            staff = await self._can_staff_manage_workspace(ctx, ctx.organization_id)
        if mine or not staff:
            stmt = stmt.where(ArtistApplication.user_id == ctx.user_id)
        stmt = stmt.order_by(ArtistApplication.created_at.desc(), ArtistApplication.id.desc())
        if cursor:
            data = decode_cursor(cursor)
            stmt = stmt.where(ArtistApplication.created_at < data["t"])
        stmt = stmt.limit(page + 1)
        rows = list((await self.session.execute(stmt)).scalars().all())
        next_cursor = None
        if len(rows) > page:
            last = rows[page - 1]
            next_cursor = encode_cursor(last.created_at.isoformat(), last.id)
            rows = rows[:page]
        return rows, next_cursor

    async def get_application(self, ctx: AuthContext, application_id: UUID) -> ArtistApplication:
        row = await self.get_application_row(application_id)
        if row.user_id == ctx.user_id:
            return row
        if ctx.organization_id is not None and await self._can_staff_manage_workspace(
            ctx, ctx.organization_id
        ):
            return row
        raise NotFoundError("Application not found")

    async def transition_application(
        self,
        ctx: AuthContext,
        application_id: UUID,
        *,
        action: str,
        expected_version: int | None = None,
    ) -> ArtistApplication:
        row = await self.get_application_row(application_id)
        target = application_target_for_action(action)
        if action == "withdraw":
            if row.user_id != ctx.user_id:
                raise NotFoundError("Application not found")
        else:
            if ctx.organization_id is None or not await self._can_staff_manage_workspace(
                ctx, ctx.organization_id
            ):
                raise NotFoundError("Application not found")
            await self._require_active_org(ctx.organization_id)
        if expected_version is not None and row.version != expected_version:
            raise ConflictError("Application version conflict")
        previous = row.status
        application_transition_action(previous, target)
        row.status = target
        row.updated_by = ctx.user_id
        artist = None
        if row.artist_id is not None:
            artist = await self.get_artist_row(row.artist_id)
            if expected_version is not None and artist.version != expected_version:
                pass
            artist_action = action if action != "withdraw" else None
            if artist_action == "start_review" and artist.status == "APPLIED":
                artist.status = "UNDER_REVIEW"
            elif artist_action == "approve" and artist.status == "UNDER_REVIEW":
                artist.status = "APPROVED"
                if artist.primary_org_id is None:
                    artist.primary_org_id = ctx.organization_id
            elif artist_action == "reject" and artist.status == "UNDER_REVIEW":
                artist.status = "REJECTED"
            artist.updated_by = ctx.user_id
        await self._flush_versioned()
        if action == "approve" and artist is not None and artist.claimed_user_id is not None:
            await self.authz.grant_resource(
                principal_type="user",
                principal_id=artist.claimed_user_id,
                permission_key="artist.manage",
                resource_type="artist",
                resource_id=artist.id,
                ctx=ctx,
            )
        await self.audit.record_from_auth(
            ctx,
            action=f"artist_application.{action}",
            entity_type="ArtistApplication",
            entity_id=row.id,
            previous_state={"status": previous},
            new_state={"status": row.status},
            organization_id=ctx.organization_id,
        )
        return row

    async def grant_artist_member(
        self,
        ctx: AuthContext,
        artist_id: UUID,
        *,
        user_id: UUID,
    ) -> None:
        artist = await self.get_artist_row(artist_id)
        await self._assert_artist_perm(ctx, artist, "artist.manage", mutate=True)
        if artist.primary_org_id is not None:
            await self._require_active_org(artist.primary_org_id)
        user = await self.session.get(User, user_id)
        if user is None or user.deleted_at is not None:
            raise AppError("VALIDATION_ERROR", "User was not found", 422)
        await self.authz.grant_resource(
            principal_type="user",
            principal_id=user_id,
            permission_key="artist.manage",
            resource_type="artist",
            resource_id=artist.id,
            ctx=ctx,
        )

    async def create_band(
        self,
        ctx: AuthContext,
        *,
        name: str,
        bio: str | None = None,
        extra_metadata: dict[str, Any] | None = None,
        portrait_asset_id: UUID | None = None,
        organization_id: UUID | None = None,
    ) -> Band:
        org_id = self._workspace_org_id(ctx, organization_id)
        await self._require_active_org(org_id)
        if not await self._can_staff_manage_workspace(ctx, org_id):
            raise ForbiddenError("Missing permission artist.manage")
        trimmed = name.strip()
        if not trimmed:
            raise AppError("VALIDATION_ERROR", "Band name is required", 422)
        band = Band(
            name=trimmed,
            status="FORMING",
            primary_org_id=org_id,
            bio=bio.strip() if bio else None,
            extra_metadata=self._meta(extra_metadata),
            portrait_asset_id=await self._portrait(portrait_asset_id),
            created_by=ctx.user_id,
        )
        self.session.add(band)
        await self.session.flush()
        await self.audit.record_from_auth(
            ctx,
            action="band.created",
            entity_type="Band",
            entity_id=band.id,
            new_state={"name": band.name, "status": band.status, "primary_org_id": str(org_id)},
            organization_id=org_id,
        )
        return band

    async def get_band(self, band_id: UUID, ctx: AuthContext | None) -> tuple[Band, bool]:
        band = await self.get_band_row(band_id)
        public = self._is_public_band(band)
        if ctx is None:
            if not public:
                raise NotFoundError("Band not found")
            return band, True
        allowed = await self._is_allowed(
            ctx.user_id,
            "artist.manage",
            resource_type="band",
            resource_id=band.id,
            organization_id=band.primary_org_id,
        )
        if allowed:
            return band, False
        member = await self._active_or_invited_member(band.id, ctx.user_id)
        if member is not None:
            return band, False
        if public:
            return band, True
        raise NotFoundError("Band not found")

    async def list_bands(
        self,
        ctx: AuthContext | None,
        *,
        cursor: str | None = None,
        limit: int | None = None,
    ) -> tuple[list[Band], str | None, bool]:
        page = clamp_limit(limit)
        stmt: Select[tuple[Band]] = select(Band).where(Band.deleted_at.is_(None))
        public_only = True
        if ctx is not None and ctx.organization_id is not None:
            if await self._can_staff_manage_workspace(ctx, ctx.organization_id):
                public_only = False
                stmt = stmt.where(Band.primary_org_id == ctx.organization_id)
        if public_only:
            stmt = stmt.where(Band.status.in_(tuple(PUBLIC_BAND_STATUSES)))
        stmt = stmt.order_by(Band.created_at.desc(), Band.id.desc())
        if cursor:
            data = decode_cursor(cursor)
            stmt = stmt.where(Band.created_at < data["t"])
        stmt = stmt.limit(page + 1)
        rows = list((await self.session.execute(stmt)).scalars().all())
        next_cursor = None
        if len(rows) > page:
            last = rows[page - 1]
            next_cursor = encode_cursor(last.created_at.isoformat(), last.id)
            rows = rows[:page]
        return rows, next_cursor, public_only

    async def update_band(
        self,
        ctx: AuthContext,
        band_id: UUID,
        *,
        name: str | None = None,
        bio: str | None | object = ...,
        extra_metadata: dict[str, Any] | None | object = ...,
        portrait_asset_id: UUID | None | object = ...,
        expected_version: int | None = None,
    ) -> Band:
        band = await self.get_band_row(band_id)
        await self._assert_band_perm(ctx, band, "artist.manage", mutate=True)
        if band.primary_org_id is not None:
            await self._require_active_org(band.primary_org_id)
        if band.status == "DISBANDED":
            raise AppError("INVALID_TRANSITION", "Band cannot be edited in this state", 409)
        if expected_version is not None and band.version != expected_version:
            raise ConflictError("Band version conflict")
        previous = {"name": band.name, "status": band.status, "version": band.version}
        if name is not None:
            trimmed = name.strip()
            if not trimmed:
                raise AppError("VALIDATION_ERROR", "Band name is required", 422)
            band.name = trimmed
        if bio is not ...:
            band.bio = bio.strip() if isinstance(bio, str) and bio else None
        if extra_metadata is not ...:
            band.extra_metadata = self._meta(extra_metadata if isinstance(extra_metadata, dict) else None)
        if portrait_asset_id is not ...:
            band.portrait_asset_id = await self._portrait(
                portrait_asset_id if isinstance(portrait_asset_id, UUID) else None
            )
        band.updated_by = ctx.user_id
        await self._flush_versioned()
        await self.audit.record_from_auth(
            ctx,
            action="band.updated",
            entity_type="Band",
            entity_id=band.id,
            previous_state=previous,
            new_state={"name": band.name, "version": band.version},
            organization_id=band.primary_org_id,
        )
        return band

    async def transition_band(
        self,
        ctx: AuthContext,
        band_id: UUID,
        *,
        action: str,
        expected_version: int | None = None,
    ) -> Band:
        band = await self.get_band_row(band_id)
        await self._assert_band_perm(ctx, band, "artist.manage", mutate=True)
        if band.primary_org_id is not None:
            await self._require_active_org(band.primary_org_id)
        if expected_version is not None and band.version != expected_version:
            raise ConflictError("Band version conflict")
        target = band_target_for_action(action)
        previous = band.status
        band_transition_action(previous, target)
        band.status = target
        band.updated_by = ctx.user_id
        await self._flush_versioned()
        await self.audit.record_from_auth(
            ctx,
            action=f"band.{action}",
            entity_type="Band",
            entity_id=band.id,
            previous_state={"status": previous},
            new_state={"status": band.status},
            organization_id=band.primary_org_id,
        )
        return band

    async def _active_or_invited_member(self, band_id: UUID, user_id: UUID) -> BandMember | None:
        stmt = select(BandMember).where(
            BandMember.band_id == band_id,
            BandMember.user_id == user_id,
            BandMember.deleted_at.is_(None),
            BandMember.status.in_(("INVITED", "ACTIVE")),
        )
        return (await self.session.execute(stmt)).scalar_one_or_none()

    async def invite_member(
        self,
        ctx: AuthContext,
        band_id: UUID,
        *,
        user_id: UUID | None = None,
        artist_id: UUID | None = None,
        role_label: str | None = None,
    ) -> BandMember:
        band = await self.get_band_row(band_id)
        await self._assert_band_perm(ctx, band, "artist.manage", mutate=True)
        if band.primary_org_id is not None:
            await self._require_active_org(band.primary_org_id)
        if band.status == "DISBANDED":
            raise AppError("INVALID_TRANSITION", "Disbanded bands cannot add members", 409)
        if user_id is None and artist_id is None:
            raise AppError("VALIDATION_ERROR", "user_id or artist_id is required", 422)
        if user_id is not None:
            user = await self.session.get(User, user_id)
            if user is None or user.deleted_at is not None:
                raise AppError("VALIDATION_ERROR", "User was not found", 422)
        if artist_id is not None:
            await self.get_artist_row(artist_id)
        label = role_label.strip() if role_label else None
        member = BandMember(
            band_id=band.id,
            user_id=user_id,
            artist_id=artist_id,
            role_label=label,
            status="INVITED",
            created_by=ctx.user_id,
        )
        self.session.add(member)
        try:
            await self.session.flush()
        except IntegrityError as exc:
            raise ConflictError("Active membership already exists") from exc
        await self._emit(
            event_type=BAND_MEMBER_CHANGED,
            aggregate_type="Band",
            aggregate_id=band.id,
            payload={
                "member_id": str(member.id),
                "status": member.status,
                "user_id": str(user_id) if user_id else None,
                "artist_id": str(artist_id) if artist_id else None,
            },
            ctx=ctx,
            organization_id=band.primary_org_id,
        )
        await self.audit.record_from_auth(
            ctx,
            action="band_member.invited",
            entity_type="BandMember",
            entity_id=member.id,
            new_state={"status": "INVITED", "band_id": str(band.id), "role_label": label},
            organization_id=band.primary_org_id,
        )
        return member

    async def list_members(
        self,
        ctx: AuthContext | None,
        band_id: UUID,
    ) -> list[BandMember]:
        band, public_view = await self.get_band(band_id, ctx)
        stmt = select(BandMember).where(
            BandMember.band_id == band.id,
            BandMember.deleted_at.is_(None),
        )
        if public_view:
            stmt = stmt.where(BandMember.status == "ACTIVE")
        stmt = stmt.order_by(BandMember.created_at.asc())
        return list((await self.session.execute(stmt)).scalars().all())

    async def transition_member(
        self,
        ctx: AuthContext,
        band_id: UUID,
        member_id: UUID,
        *,
        action: str,
    ) -> BandMember:
        band = await self.get_band_row(band_id)
        member = await self.session.get(BandMember, member_id)
        if member is None or member.deleted_at is not None or member.band_id != band.id:
            raise NotFoundError("Membership not found")
        target = member_target_for_action(action)
        member_transition_action(member.status, target)
        if action in {"accept", "leave"}:
            if member.user_id != ctx.user_id:
                raise NotFoundError("Membership not found")
        else:
            await self._assert_band_perm(ctx, band, "artist.manage", mutate=True)
            if band.primary_org_id is not None:
                await self._require_active_org(band.primary_org_id)
        previous = member.status
        member.status = target
        member.updated_by = ctx.user_id
        now = self.clock.now()
        if target == "ACTIVE":
            member.started_at = member.started_at or now
            member.ended_at = None
        if target in {"LEFT", "REMOVED"}:
            member.ended_at = now
        try:
            await self.session.flush()
        except IntegrityError as exc:
            raise ConflictError("Active membership already exists") from exc
        await self._emit(
            event_type=BAND_MEMBER_CHANGED,
            aggregate_type="Band",
            aggregate_id=band.id,
            payload={
                "member_id": str(member.id),
                "previous_status": previous,
                "status": member.status,
            },
            ctx=ctx,
            organization_id=band.primary_org_id,
        )
        await self.audit.record_from_auth(
            ctx,
            action=f"band_member.{action}",
            entity_type="BandMember",
            entity_id=member.id,
            previous_state={"status": previous},
            new_state={"status": member.status},
            organization_id=band.primary_org_id,
        )
        return member

    async def _follow_target(self, target_type: str, target_id: UUID) -> tuple[str, UUID | None]:
        if target_type == "ARTIST":
            artist = await self.get_artist_row(target_id)
            if artist.status not in PUBLIC_ARTIST_STATUSES:
                raise NotFoundError("Artist not found")
            return "Artist", artist.primary_org_id
        if target_type == "BAND":
            band = await self.get_band_row(target_id)
            if band.status not in PUBLIC_BAND_STATUSES:
                raise NotFoundError("Band not found")
            return "Band", band.primary_org_id
        raise AppError("VALIDATION_ERROR", "Invalid follow target", 422)

    async def follow(
        self,
        ctx: AuthContext,
        *,
        target_type: str,
        target_id: UUID,
    ) -> Follow:
        aggregate_type, org_id = await self._follow_target(target_type, target_id)
        stmt = select(Follow).where(
            Follow.user_id == ctx.user_id,
            Follow.target_type == target_type,
            Follow.target_id == target_id,
            Follow.deleted_at.is_(None),
        )
        row = (await self.session.execute(stmt)).scalar_one_or_none()
        if row is None:
            row = Follow(
                user_id=ctx.user_id,
                target_type=target_type,
                target_id=target_id,
                status="ACTIVE",
                created_by=ctx.user_id,
            )
            self.session.add(row)
        else:
            row.status = "ACTIVE"
            row.updated_by = ctx.user_id
        try:
            await self.session.flush()
        except IntegrityError as exc:
            raise ConflictError("Already following") from exc
        await self._emit(
            event_type=ARTIST_FOLLOWED,
            aggregate_type=aggregate_type,
            aggregate_id=target_id,
            payload={"target_type": target_type, "user_id": str(ctx.user_id)},
            ctx=ctx,
            organization_id=org_id,
        )
        await self.audit.record_from_auth(
            ctx,
            action="follow.created",
            entity_type="Follow",
            entity_id=row.id,
            new_state={"status": "ACTIVE", "target_type": target_type, "target_id": str(target_id)},
            organization_id=org_id,
        )
        return row

    async def unfollow(
        self,
        ctx: AuthContext,
        *,
        target_type: str,
        target_id: UUID,
    ) -> Follow:
        aggregate_type, org_id = await self._follow_target(target_type, target_id)
        stmt = select(Follow).where(
            Follow.user_id == ctx.user_id,
            Follow.target_type == target_type,
            Follow.target_id == target_id,
            Follow.deleted_at.is_(None),
            Follow.status == "ACTIVE",
        )
        row = (await self.session.execute(stmt)).scalar_one_or_none()
        if row is None:
            raise NotFoundError("Follow not found")
        row.status = "UNFOLLOWED"
        row.updated_by = ctx.user_id
        await self.session.flush()
        await self._emit(
            event_type=ARTIST_UNFOLLOWED,
            aggregate_type=aggregate_type,
            aggregate_id=target_id,
            payload={"target_type": target_type, "user_id": str(ctx.user_id)},
            ctx=ctx,
            organization_id=org_id,
        )
        await self.audit.record_from_auth(
            ctx,
            action="follow.removed",
            entity_type="Follow",
            entity_id=row.id,
            previous_state={"status": "ACTIVE"},
            new_state={"status": "UNFOLLOWED"},
            organization_id=org_id,
        )
        return row
