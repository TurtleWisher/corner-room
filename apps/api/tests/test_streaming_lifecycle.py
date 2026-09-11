"""Streaming lifecycle unit tests — no database."""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

import jwt
import pytest

from cornerroom.infra.errors import AppError
from cornerroom.infra.settings import Settings
from cornerroom.infra.storage import LocalObjectStorage
from cornerroom.modules.streaming.application.delivery import (
    ADAPTER_SIGNED_URL_SECONDS,
    AUDIO_TOKEN_USE,
    ObjectStorageAudioDelivery,
)
from cornerroom.modules.streaming.domain.lifecycle import (
    permission_for_editorial_action,
    playlist_transition_action,
    session_transition_action,
)


def test_session_open_to_closed() -> None:
    assert session_transition_action("OPEN", "CLOSED") == "close"


def test_session_cannot_reopen() -> None:
    with pytest.raises(AppError) as exc:
        session_transition_action("CLOSED", "OPEN")
    assert exc.value.code == "INVALID_TRANSITION"


def test_user_playlist_archive() -> None:
    assert playlist_transition_action("USER", "ACTIVE", "ARCHIVED") == "archive"


def test_editorial_publish() -> None:
    assert playlist_transition_action("EDITORIAL", "DRAFT", "PUBLISHED") == "publish"
    assert permission_for_editorial_action("publish") == "music.approve"


def test_editorial_cannot_publish_from_archived() -> None:
    with pytest.raises(AppError) as exc:
        playlist_transition_action("EDITORIAL", "ARCHIVED", "PUBLISHED")
    assert exc.value.code == "INVALID_TRANSITION"


def test_audio_delivery_mints_purpose_token_not_master_key(tmp_path) -> None:
    settings = Settings(
        app_env="test",
        jwt_secret="test-secret-not-for-production-use-please",
        database_url="postgresql+asyncpg://cornerroom:cornerroom@localhost:5432/cornerroom",
        redis_url="redis://localhost:6379/0",
    )
    delivery = ObjectStorageAudioDelivery(settings, LocalObjectStorage(str(tmp_path)))
    user_id = uuid4()
    track_id = uuid4()
    version_id = uuid4()
    asset_id = uuid4()
    now = datetime.now(timezone.utc)
    minted = delivery.mint(
        user_id=user_id,
        track_id=track_id,
        track_version_id=version_id,
        media_asset_id=asset_id,
        object_key="catalog_audio/secret-master.wav",
        now=now,
    )
    assert minted.url.startswith("/api/v1/playback/media/")
    assert "secret-master.wav" not in minted.url
    assert minted.expires_at > now
    assert delivery.expiry_seconds() == ADAPTER_SIGNED_URL_SECONDS
    payload = jwt.decode(
        minted.url.rsplit("/", 1)[-1],
        settings.jwt_secret,
        algorithms=["HS256"],
        issuer=settings.jwt_issuer,
    )
    assert payload["token_use"] == AUDIO_TOKEN_USE
    assert payload["tid"] == str(track_id)
    parsed = delivery.parse_token(minted.url.rsplit("/", 1)[-1])
    assert parsed["aid"] == str(asset_id)
