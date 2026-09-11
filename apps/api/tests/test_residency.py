"""Q-P0-12 residency gate."""

from __future__ import annotations

import pytest

from cornerroom.infra.errors import ResidencyGateError
from cornerroom.infra.settings import Settings
from cornerroom.infra.storage import assert_storage_class_allowed


def test_production_blocks_masters_without_region() -> None:
    settings = Settings(
        app_env="production",
        residency_region=None,
        jwt_secret="a-sufficiently-long-production-secret!!",
        cookie_secure=True,
    )
    with pytest.raises(ResidencyGateError):
        assert_storage_class_allowed("catalog_audio", settings)
    with pytest.raises(ResidencyGateError):
        assert_storage_class_allowed("legal_document", settings)


def test_local_allows_public_media() -> None:
    settings = Settings(app_env="local", residency_region=None)
    assert_storage_class_allowed("public_media", settings)


def test_named_region_allows_gated_class() -> None:
    settings = Settings(
        app_env="production",
        residency_region="ap-south-1",
        jwt_secret="a-sufficiently-long-production-secret!!",
        cookie_secure=True,
    )
    assert_storage_class_allowed("catalog_audio", settings)
