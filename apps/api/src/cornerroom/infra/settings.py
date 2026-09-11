"""Typed environment configuration. Secrets never belong in git."""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

INSECURE_JWT_SECRETS = frozenset(
    {
        "change-me",
        "change-me-to-a-long-random-secret",
        "secret",
        "jwt-secret",
    }
)

EnvironmentName = Literal["local", "development", "test", "staging", "production"]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    app_env: str = "local"
    app_name: str = "cornerroom"
    log_level: str = "INFO"

    database_url: str = "postgresql+asyncpg://cornerroom:cornerroom@localhost:5432/cornerroom"
    database_url_sync: str = "postgresql+psycopg://cornerroom:cornerroom@localhost:5432/cornerroom"
    db_pool_size: int = 10
    db_max_overflow: int = 20

    redis_url: str = "redis://localhost:6379/0"
    redis_key_prefix: str = "cr"
    redis_socket_timeout_seconds: float = 2.0

    jwt_secret: str = "change-me-to-a-long-random-secret"
    jwt_access_ttl_seconds: int = 900
    jwt_refresh_ttl_seconds: int = 604800
    jwt_issuer: str = "cornerroom"

    cookie_secure: bool = False
    cookie_samesite: str = "lax"
    cookie_domain: str | None = None
    refresh_cookie_name: str = "cr_refresh"

    cors_origins: list[str] = Field(default_factory=lambda: ["http://localhost:3000"])

    storage_backend: str = "local"
    storage_local_path: str = "./var/storage"
    s3_endpoint_url: str | None = None
    s3_access_key: str | None = None
    s3_secret_key: str | None = None
    s3_bucket: str | None = None
    s3_region: str | None = None

    residency_region: str | None = None

    bootstrap_admin_email: str | None = None
    bootstrap_admin_password: str | None = None

    # Auth controls. 0 = disabled. Do not treat defaults as product lockout/OTP policy.
    auth_rate_limit_max_attempts: int = 0
    auth_rate_limit_window_seconds: int = 0
    verification_challenge_ttl_seconds: int = 0
    password_recovery_ttl_seconds: int = 0
    # 0 = no expiry. Do not treat a default as product invite policy.
    organization_invitation_ttl_seconds: int = 0
    # ASSUMED operational hold TTL (Q-P5-01). Not a commercial fee/timeout product decision.
    ticket_hold_ttl_seconds: int = 900
    # Q-P0-04: store tax lines; config rate 0 until a real rate is set. Never hard-code VAT.
    tax_rate_bps: int = 0
    sandbox_payment_secret: str | None = None

    outbox_max_attempts: int = 8
    outbox_backoff_seconds: int = 15
    idempotency_ttl_seconds: int = 86400
    pagination_default_limit: int = 50
    pagination_max_limit: int = 100

    @field_validator("cors_origins", mode="before")
    @classmethod
    def split_origins(cls, value: object) -> object:
        if isinstance(value, str):
            return [item.strip() for item in value.split(",") if item.strip()]
        return value

    @field_validator("app_env")
    @classmethod
    def normalize_env(cls, value: str) -> str:
        normalized = value.strip().lower()
        aliases = {"dev": "development", "prod": "production", "stage": "staging"}
        return aliases.get(normalized, normalized)

    @field_validator("database_url", "database_url_sync")
    @classmethod
    def require_postgres_url(cls, value: str) -> str:
        if "postgresql" not in value:
            raise ValueError("Database URL must be a PostgreSQL connection string")
        return value

    @field_validator("redis_url")
    @classmethod
    def require_redis_url(cls, value: str) -> str:
        if not value.startswith(("redis://", "rediss://")):
            raise ValueError("REDIS_URL must start with redis:// or rediss://")
        return value

    @field_validator("storage_backend")
    @classmethod
    def require_known_storage(cls, value: str) -> str:
        allowed = {"local", "s3"}
        if value not in allowed:
            raise ValueError(f"STORAGE_BACKEND must be one of {sorted(allowed)}")
        return value

    @model_validator(mode="after")
    def production_must_not_use_insecure_defaults(self) -> Settings:
        if not self.is_production:
            return self
        if self.jwt_secret in INSECURE_JWT_SECRETS or len(self.jwt_secret) < 32:
            raise ValueError("JWT_SECRET must be a strong unique secret in production")
        if not self.cookie_secure:
            raise ValueError("COOKIE_SECURE must be true in production")
        if self.storage_backend == "s3" and not self.s3_bucket:
            raise ValueError("S3_BUCKET is required when STORAGE_BACKEND=s3 in production")
        return self

    @property
    def is_production(self) -> bool:
        return self.app_env in {"prod", "production"}

    @property
    def is_test(self) -> bool:
        return self.app_env == "test"

    def redis_key(self, *parts: str) -> str:
        tokens = [self.redis_key_prefix, self.app_env, *[str(part) for part in parts if part]]
        return ":".join(tokens)


@lru_cache
def get_settings() -> Settings:
    return Settings()
