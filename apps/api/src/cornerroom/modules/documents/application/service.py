"""Upload sessions — no production masters or government IDs without a named region."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from cornerroom.infra.errors import AppError
from cornerroom.infra.settings import Settings
from cornerroom.infra.storage import (
    ALLOWED_UPLOAD_CLASSES,
    assert_storage_class_allowed,
    build_object_key,
    get_storage,
    new_asset_id,
)
from cornerroom.kernel.auth_context import AuthContext
from cornerroom.modules.audit.application.service import AuditService
from cornerroom.modules.documents.domain.models import MediaAsset


class DocumentService:
    def __init__(self, session: AsyncSession, settings: Settings) -> None:
        self.session = session
        self.settings = settings
        self.storage = get_storage(settings)
        self.audit = AuditService(session)

    async def create_upload_session(
        self,
        ctx: AuthContext,
        *,
        storage_class: str,
        filename: str,
        mime: str,
    ) -> tuple[MediaAsset, str]:
        if storage_class not in ALLOWED_UPLOAD_CLASSES:
            if storage_class in {"catalog_audio", "legal_document"}:
                assert_storage_class_allowed(storage_class, self.settings)
            raise AppError(
                "STORAGE_CLASS_NOT_ALLOWED",
                "Storage class not allowed",
                400,
                f"Phase 0 accepts: {sorted(ALLOWED_UPLOAD_CLASSES)}",
            )
        assert_storage_class_allowed(storage_class, self.settings)
        asset_id = new_asset_id()
        object_key = build_object_key(storage_class, asset_id, filename)
        asset = MediaAsset(
            id=asset_id,
            storage_class=storage_class,
            bucket=getattr(self.storage, "bucket", "local"),
            object_key=object_key,
            mime=mime,
            byte_size=0,
            sha256="",
            status="PENDING",
            scan_status="PENDING",
            created_by=ctx.user_id,
        )
        self.session.add(asset)
        await self.session.flush()
        await self.audit.record_from_auth(
            ctx,
            action="upload.session_created",
            entity_type="MediaAsset",
            entity_id=asset.id,
            new_state={"class": storage_class, "object_key": object_key},
        )
        put_url = await self.storage.signed_url(object_key)
        return asset, put_url

    async def complete_upload(
        self,
        ctx: AuthContext,
        *,
        asset_id: UUID,
        data: bytes,
    ) -> MediaAsset:
        asset = await self.session.get(MediaAsset, asset_id)
        if asset is None or asset.deleted_at is not None:
            raise AppError("NOT_FOUND", "Upload session not found", 404)
        stored = await self.storage.put(
            object_key=asset.object_key,
            data=data,
            mime=asset.mime,
            storage_class=asset.storage_class,
        )
        asset.byte_size = stored.byte_size
        asset.sha256 = stored.sha256
        asset.bucket = stored.bucket
        asset.status = "READY"
        asset.scan_status = "SKIPPED_LOCAL"
        asset.updated_by = ctx.user_id
        await self.session.flush()
        await self.audit.record_from_auth(
            ctx,
            action="upload.completed",
            entity_type="MediaAsset",
            entity_id=asset.id,
            new_state={"status": "READY", "byte_size": asset.byte_size, "sha256": asset.sha256},
        )
        return asset
