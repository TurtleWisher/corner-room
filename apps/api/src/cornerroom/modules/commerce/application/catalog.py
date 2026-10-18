"""Staff-configured Product and Offer. Amounts are data — never defaulted in code."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm.exc import StaleDataError
from sqlalchemy.ext.asyncio import AsyncSession

from cornerroom.infra.errors import AppError, ConflictError, NotFoundError
from cornerroom.infra.outbox import enqueue_outbox
from cornerroom.kernel.auth_context import AuthContext
from cornerroom.kernel.clock import Clock, SystemClock
from cornerroom.kernel.events import DomainEvent, OFFER_ACTIVATED, PRODUCT_ACTIVATED
from cornerroom.kernel.money import Money
from cornerroom.kernel.pagination import clamp_limit, encode_cursor, keyset_before
from cornerroom.modules.audit.application.service import AuditService
from cornerroom.modules.authorization.application.service import AuthorizationService
from cornerroom.modules.commerce.domain.lifecycle import (
    OFFER_AUDIENCES,
    PRODUCT_TYPES,
    offer_transition_action,
    product_transition_action,
)
from cornerroom.modules.commerce.domain.models import Offer, Product
from cornerroom.modules.identity.domain.models import Organization
from cornerroom.modules.music.domain.models import Track


class CatalogCommerceService:
    def __init__(
        self,
        session: AsyncSession,
        clock: Clock | None = None,
    ) -> None:
        self.session = session
        self.clock = clock or SystemClock()
        self.audit = AuditService(session)
        self.authz = AuthorizationService(session, clock=self.clock)

    async def _emit(
        self,
        ctx: AuthContext,
        *,
        event_type: str,
        aggregate_type: str,
        aggregate_id: UUID,
        organization_id: UUID,
        payload: dict[str, Any],
    ) -> None:
        domain = DomainEvent(
            event_type=event_type,
            producer="commerce",
            aggregate_type=aggregate_type,
            aggregate_id=aggregate_id,
            payload=payload,
            occurred_at=self.clock.now(),
            actor_id=ctx.user_id,
            organization_id=organization_id,
            correlation_id=ctx.request_id,
        )
        await enqueue_outbox(self.session, domain)

    async def _require_org(self, organization_id: UUID) -> Organization:
        org = await self.session.get(Organization, organization_id)
        if org is None or org.deleted_at is not None:
            raise NotFoundError("Organization not found")
        if org.status != "ACTIVE":
            raise AppError("ORGANIZATION_NOT_ACTIVE", "Organization is not active", 409)
        return org

    async def _assert_write(
        self,
        ctx: AuthContext,
        *,
        resource_type: str,
        resource_id: UUID,
        organization_id: UUID,
    ) -> None:
        await self.authz.authorize(
            ctx.user_id,
            "commerce.write",
            resource_type=resource_type,
            resource_id=resource_id,
            scope_organization_id=organization_id,
        )

    async def _flush_versioned(self) -> None:
        try:
            await self.session.flush()
        except StaleDataError as exc:
            raise ConflictError("The resource was updated concurrently") from exc

    async def create_product(
        self,
        ctx: AuthContext,
        *,
        product_type: str,
        subject_id: UUID,
        name: str,
        organization_id: UUID | None = None,
    ) -> Product:
        org_id = organization_id or ctx.organization_id
        if org_id is None:
            raise AppError("WORKSPACE_REQUIRED", "An active organization is required", 409)
        await self._require_org(org_id)
        await self.authz.authorize(
            ctx.user_id,
            "commerce.write",
            resource_type="organization",
            resource_id=org_id,
            scope_organization_id=org_id,
        )
        if product_type not in PRODUCT_TYPES:
            raise AppError("VALIDATION_ERROR", "Unknown product type", 422)
        if product_type == "TRACK":
            track = await self.session.get(Track, subject_id)
            if track is None or track.deleted_at is not None:
                raise NotFoundError("Track not found")
            await self.assert_track_sold_separately(subject_id)
        if product_type == "RELEASE":
            from cornerroom.modules.music.domain.models import Release

            release = await self.session.get(Release, subject_id)
            if release is None or release.deleted_at is not None:
                raise NotFoundError("Release not found")
        row = Product(
            organization_id=org_id,
            product_type=product_type,
            subject_id=subject_id,
            name=name.strip(),
            status="DRAFT",
            created_by=ctx.user_id,
            updated_by=ctx.user_id,
        )
        if not row.name:
            raise AppError("VALIDATION_ERROR", "Name is required", 422)
        self.session.add(row)
        await self.session.flush()
        await self.audit.record_from_auth(
            ctx,
            action="product.created",
            entity_type="Product",
            entity_id=row.id,
            new_state={"status": row.status, "product_type": row.product_type},
            organization_id=org_id,
        )
        return row

    async def transition_product(
        self,
        ctx: AuthContext,
        product_id: UUID,
        *,
        action: str,
        expected_version: int | None = None,
    ) -> Product:
        row = await self.session.get(Product, product_id)
        if row is None or row.deleted_at is not None:
            raise NotFoundError("Product not found")
        await self._assert_write(
            ctx, resource_type="product", resource_id=row.id, organization_id=row.organization_id
        )
        if expected_version is not None and row.version != expected_version:
            raise ConflictError("The resource was updated concurrently")
        target = {"activate": "ACTIVE", "retire": "RETIRED"}.get(action)
        if target is None:
            raise AppError("VALIDATION_ERROR", "Unknown product action", 422)
        product_transition_action(row.status, target)
        row.status = target
        row.updated_by = ctx.user_id
        await self._flush_versioned()
        if target == "ACTIVE":
            await self._emit(
                ctx,
                event_type=PRODUCT_ACTIVATED,
                aggregate_type="Product",
                aggregate_id=row.id,
                organization_id=row.organization_id,
                payload={"product_id": str(row.id), "product_type": row.product_type},
            )
        await self.audit.record_from_auth(
            ctx,
            action=f"product.{action}",
            entity_type="Product",
            entity_id=row.id,
            new_state={"status": row.status},
            organization_id=row.organization_id,
        )
        return row

    async def create_offer(
        self,
        ctx: AuthContext,
        *,
        product_id: UUID,
        amount_minor: int,
        currency_code: str,
        audience: str = "EVERYONE",
    ) -> Offer:
        product = await self.session.get(Product, product_id)
        if product is None or product.deleted_at is not None:
            raise NotFoundError("Product not found")
        if audience not in OFFER_AUDIENCES or (audience != "EVERYONE" and product.product_type != "RELEASE"):
            raise AppError("VALIDATION_ERROR", "This price audience only applies to releases", 422)
        await self._assert_write(
            ctx,
            resource_type="product",
            resource_id=product.id,
            organization_id=product.organization_id,
        )
        money = Money(amount_minor=amount_minor, currency_code=currency_code)
        row = Offer(
            organization_id=product.organization_id,
            product_id=product.id,
            amount_minor=money.amount_minor,
            currency_code=money.currency_code,
            status="DRAFT",
            audience=audience,
            created_by=ctx.user_id,
            updated_by=ctx.user_id,
        )
        self.session.add(row)
        await self.session.flush()
        await self.audit.record_from_auth(
            ctx,
            action="offer.created",
            entity_type="Offer",
            entity_id=row.id,
            new_state={
                "status": row.status,
                "amount_minor": row.amount_minor,
                "currency_code": row.currency_code,
            },
            organization_id=product.organization_id,
        )
        return row

    async def transition_offer(
        self,
        ctx: AuthContext,
        offer_id: UUID,
        *,
        action: str,
        expected_version: int | None = None,
    ) -> Offer:
        row = await self.session.get(Offer, offer_id)
        if row is None or row.deleted_at is not None:
            raise NotFoundError("Offer not found")
        product = await self.session.get(Product, row.product_id)
        if product is None:
            raise NotFoundError("Product not found")
        await self._assert_write(
            ctx,
            resource_type="offer",
            resource_id=row.id,
            organization_id=row.organization_id,
        )
        if expected_version is not None and row.version != expected_version:
            raise ConflictError("The resource was updated concurrently")
        target = {"activate": "ACTIVE", "retire": "RETIRED"}.get(action)
        if target is None:
            raise AppError("VALIDATION_ERROR", "Unknown offer action", 422)
        if target == "ACTIVE" and product.status != "ACTIVE":
            raise AppError(
                "PRODUCT_NOT_ACTIVE",
                "Activate the product before the offer",
                409,
            )
        if target == "ACTIVE":
            other = (
                await self.session.execute(
                    select(Offer).where(
                        Offer.product_id == row.product_id,
                        Offer.audience == row.audience,
                        Offer.status == "ACTIVE",
                        Offer.deleted_at.is_(None),
                        Offer.id != row.id,
                    )
                )
            ).scalar_one_or_none()
            if other is not None:
                raise AppError(
                    "OFFER_ACTIVE_EXISTS",
                    "A product may have at most one ACTIVE offer per audience",
                    409,
                    "Do not invent sale stacking (Q-P9-12)",
                )
        offer_transition_action(row.status, target)
        row.status = target
        row.updated_by = ctx.user_id
        await self._flush_versioned()
        if target == "ACTIVE":
            await self._emit(
                ctx,
                event_type=OFFER_ACTIVATED,
                aggregate_type="Offer",
                aggregate_id=row.id,
                organization_id=row.organization_id,
                payload={
                    "offer_id": str(row.id),
                    "amount_minor": row.amount_minor,
                    "currency_code": row.currency_code,
                },
            )
        await self.audit.record_from_auth(
            ctx,
            action=f"offer.{action}",
            entity_type="Offer",
            entity_id=row.id,
            new_state={"status": row.status},
            organization_id=row.organization_id,
        )
        return row

    async def tracks_not_sold_separately(self, track_ids: list[UUID]) -> set[UUID]:
        """D-AUDIO-10, in one query: the songs that may not be bought on their own (every release
        they are on is a whole-release-only album or EP)."""
        from cornerroom.modules.music.domain.models import Release, ReleaseTrack

        if not track_ids:
            return set()
        rows = (
            await self.session.execute(
                select(ReleaseTrack.track_id, Release.release_type, Release.track_sales)
                .join(Release, ReleaseTrack.release_id == Release.id)
                .where(ReleaseTrack.track_id.in_(track_ids), Release.deleted_at.is_(None))
            )
        ).all()
        on_release: set[UUID] = set()
        allowed: set[UUID] = set()
        for track_id, release_type, track_sales in rows:
            on_release.add(track_id)
            if release_type == "SINGLE" or track_sales == "TRACKS_ALLOWED":
                allowed.add(track_id)
        return on_release - allowed

    async def assert_track_sold_separately(self, track_id: UUID) -> None:
        """D-AUDIO-10: a song is sold on its own only from a single, or from a release whose artist
        allows songs to be bought individually. Tracks on no release (older catalog) are unaffected."""
        if track_id in await self.tracks_not_sold_separately([track_id]):
            raise AppError(
                "TRACK_NOT_SOLD_SEPARATELY",
                "This song is sold only as part of its release",
                409,
                "The artist chose to sell the whole release only",
            )

    async def list_proposals(
        self, ctx: AuthContext, *, status: str | None = "PROPOSED", proposal_id: UUID | None = None
    ) -> list[dict[str, Any]]:
        """Price proposals for releases in the staff member's workspace (commerce.write)."""
        from cornerroom.modules.commerce.domain.models import OfferProposal
        from cornerroom.modules.music.domain.models import Release, Track

        org_id = ctx.organization_id
        if org_id is None:
            raise AppError("WORKSPACE_REQUIRED", "An active organization is required", 409)
        await self.authz.authorize(
            ctx.user_id, "commerce.write", resource_type="organization", resource_id=org_id, scope_organization_id=org_id
        )
        stmt = (
            select(OfferProposal, Release)
            .join(Release, Release.id == OfferProposal.release_id)
            .where(Release.primary_org_id == org_id)
            .order_by(OfferProposal.created_at.desc())
            .limit(200)
        )
        if status:
            stmt = stmt.where(OfferProposal.status == status)
        if proposal_id is not None:
            stmt = stmt.where(OfferProposal.id == proposal_id)
        out = []
        for proposal, release in (await self.session.execute(stmt)).all():
            subject_title = release.title
            if proposal.subject_type == "TRACK":
                track = await self.session.get(Track, proposal.subject_id)
                subject_title = track.title if track else "Unknown track"
            out.append(
                {
                    "id": proposal.id, "release_id": release.id, "release_title": release.title,
                    "release_status": release.status, "subject_type": proposal.subject_type,
                    "subject_id": proposal.subject_id, "subject_title": subject_title, "audience": proposal.audience,
                    "amount_minor": proposal.amount_minor, "currency_code": proposal.currency_code, "note": proposal.note,
                    "status": proposal.status, "decision_note": proposal.decision_note, "created_at": proposal.created_at,
                }
            )
        return out

    async def decide_proposal(
        self, ctx: AuthContext, proposal_id: UUID, *, decision: str, note: str | None = None
    ) -> Any:
        """Ops accept a proposed price (product and offer are created and switched on at exactly that
        amount) or counter it with a note so the artist proposes again (D-AUDIO-15). The system
        never computes a price."""
        from cornerroom.kernel.events import OFFER_PROPOSAL_DECIDED
        from cornerroom.modules.commerce.domain.models import OfferProposal
        from cornerroom.modules.music.domain.models import Release, Track

        proposal = await self.session.get(OfferProposal, proposal_id)
        if proposal is None:
            raise NotFoundError("Proposal not found")
        release = await self.session.get(Release, proposal.release_id)
        if release is None or release.primary_org_id is None:
            raise NotFoundError("Proposal not found")
        org_id = release.primary_org_id
        await self.authz.authorize(
            ctx.user_id, "commerce.write", resource_type="organization", resource_id=org_id, scope_organization_id=org_id
        )
        if proposal.status != "PROPOSED":
            raise AppError("INVALID_TRANSITION", "This proposal was already decided", 409)
        text = " ".join((note or "").split())[:500] or None
        if decision == "counter":
            if not text:
                raise AppError("VALIDATION_ERROR", "Tell the artist what price you suggest and why", 422)
            proposal.status = "COUNTERED"
        elif decision == "accept":
            product_type = proposal.subject_type
            if product_type == "TRACK":
                await self.assert_track_sold_separately(proposal.subject_id)
                track = await self.session.get(Track, proposal.subject_id)
                name = track.title if track else release.title
            else:
                name = release.title
            product = (
                await self.session.execute(
                    select(Product).where(
                        Product.product_type == product_type,
                        Product.subject_id == proposal.subject_id,
                        Product.organization_id == org_id,
                        Product.deleted_at.is_(None),
                        Product.status != "RETIRED",
                    )
                )
            ).scalars().first()
            if product is None:
                product = await self.create_product(ctx, product_type=product_type, subject_id=proposal.subject_id, name=name, organization_id=org_id)
            if product.status == "DRAFT":
                product = await self.transition_product(ctx, product.id, action="activate")
            for old in (
                await self.session.execute(
                    select(Offer).where(
                        Offer.product_id == product.id, Offer.audience == proposal.audience,
                        Offer.status == "ACTIVE", Offer.deleted_at.is_(None),
                    )
                )
            ).scalars().all():
                await self.transition_offer(ctx, old.id, action="retire")
            offer = await self.create_offer(
                ctx, product_id=product.id, amount_minor=proposal.amount_minor,
                currency_code=proposal.currency_code, audience=proposal.audience,
            )
            offer = await self.transition_offer(ctx, offer.id, action="activate")
            proposal.status = "ACCEPTED"
            proposal.resulting_offer_id = offer.id
        else:
            raise AppError("VALIDATION_ERROR", "Decision must be accept or counter", 422)
        proposal.decided_by = ctx.user_id
        proposal.decided_at = self.clock.now()
        proposal.decision_note = text
        await self.session.flush()
        await self._emit(
            ctx, event_type=OFFER_PROPOSAL_DECIDED, aggregate_type="Release", aggregate_id=release.id,
            organization_id=org_id, payload={"proposal_id": str(proposal.id), "decision": decision},
        )
        await self.audit.record_from_auth(
            ctx, action=f"price.proposal_{decision}", entity_type="OfferProposal", entity_id=proposal.id,
            new_state={"status": proposal.status, "amount_minor": proposal.amount_minor, "currency_code": proposal.currency_code},
            organization_id=org_id,
        )
        return proposal

    async def get_active_offer(self, offer_id: UUID) -> tuple[Offer, Product]:
        offer = await self.session.get(Offer, offer_id)
        if offer is None or offer.deleted_at is not None or offer.status != "ACTIVE":
            raise NotFoundError("Offer not found")
        product = await self.session.get(Product, offer.product_id)
        if product is None or product.deleted_at is not None or product.status != "ACTIVE":
            raise NotFoundError("Offer not found")
        return offer, product

    async def list_public_offers(
        self,
        *,
        cursor: str | None = None,
        limit: int = 50,
    ) -> tuple[list[tuple[Offer, Product]], str | None]:
        limit = clamp_limit(limit)
        stmt = (
            select(Offer, Product)
            .join(Product, Product.id == Offer.product_id)
            .where(
                Offer.status == "ACTIVE",
                Offer.deleted_at.is_(None),
                Product.status == "ACTIVE",
                Product.deleted_at.is_(None),
                Product.product_type.in_(("TRACK", "RELEASE", "CATALOG_ACCESS")),
            )
            .order_by(Offer.created_at.desc(), Offer.id.desc())
        )
        if cursor:
            stmt = stmt.where(keyset_before(Offer.created_at, Offer.id, cursor))
        rows = list((await self.session.execute(stmt.limit(limit + 1))).all())
        next_cursor = None
        if len(rows) > limit:
            last_offer = rows[limit - 1][0]
            next_cursor = encode_cursor(last_offer.created_at.isoformat(), last_offer.id)
            rows = rows[:limit]
        # D-AUDIO-10: a song whose artist sells the release only as a whole is not on sale by
        # itself, so its offer is not listed (buying it would be refused). The cursor still comes
        # from the unfiltered page, so paging stays correct.
        blocked = await self.tracks_not_sold_separately(
            [product.subject_id for _offer, product in rows if product.product_type == "TRACK"]
        )
        return [
            (offer, product)
            for offer, product in rows
            if not (product.product_type == "TRACK" and product.subject_id in blocked)
        ], next_cursor

    async def list_org_products(
        self,
        ctx: AuthContext,
        *,
        cursor: str | None = None,
        limit: int = 50,
    ) -> tuple[list[Product], str | None]:
        org_id = ctx.organization_id
        if org_id is None:
            raise AppError("WORKSPACE_REQUIRED", "An active organization is required", 409)
        await self.authz.authorize(
            ctx.user_id,
            "commerce.write",
            resource_type="organization",
            resource_id=org_id,
            scope_organization_id=org_id,
        )
        limit = clamp_limit(limit)
        stmt = (
            select(Product)
            .where(Product.organization_id == org_id, Product.deleted_at.is_(None))
            .order_by(Product.created_at.desc(), Product.id.desc())
        )
        if cursor:
            stmt = stmt.where(keyset_before(Product.created_at, Product.id, cursor))
        rows = list((await self.session.execute(stmt.limit(limit + 1))).scalars())
        next_cursor = None
        if len(rows) > limit:
            last = rows[limit - 1]
            next_cursor = encode_cursor(last.created_at.isoformat(), last.id)
            rows = rows[:limit]
        return rows, next_cursor

    async def list_org_offers(
        self,
        ctx: AuthContext,
        *,
        product_id: UUID | None = None,
        cursor: str | None = None,
        limit: int = 50,
    ) -> tuple[list[Offer], str | None]:
        org_id = ctx.organization_id
        if org_id is None:
            raise AppError("WORKSPACE_REQUIRED", "An active organization is required", 409)
        await self.authz.authorize(
            ctx.user_id,
            "commerce.write",
            resource_type="organization",
            resource_id=org_id,
            scope_organization_id=org_id,
        )
        limit = clamp_limit(limit)
        stmt = (
            select(Offer)
            .where(Offer.organization_id == org_id, Offer.deleted_at.is_(None))
            .order_by(Offer.created_at.desc(), Offer.id.desc())
        )
        if product_id is not None:
            stmt = stmt.where(Offer.product_id == product_id)
        if cursor:
            stmt = stmt.where(keyset_before(Offer.created_at, Offer.id, cursor))
        rows = list((await self.session.execute(stmt.limit(limit + 1))).scalars())
        next_cursor = None
        if len(rows) > limit:
            last = rows[limit - 1]
            next_cursor = encode_cursor(last.created_at.isoformat(), last.id)
            rows = rows[:limit]
        return rows, next_cursor

    async def get_product(self, ctx: AuthContext, product_id: UUID) -> Product:
        row = await self.session.get(Product, product_id)
        if row is None or row.deleted_at is not None:
            raise NotFoundError("Product not found")
        await self._assert_write(
            ctx, resource_type="product", resource_id=row.id, organization_id=row.organization_id
        )
        return row
