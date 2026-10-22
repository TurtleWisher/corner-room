"""Typed environment configuration. Secrets never belong in git."""

from __future__ import annotations

from functools import lru_cache
import json
from typing import Annotated, Literal

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

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
    # Separate keys so one leaked secret cannot forge the others (Gate 1 M7). Required and distinct
    # in production; elsewhere unset falls back to JWT_SECRET so local QR codes keep working.
    ticket_signing_secret: str | None = None
    media_token_secret: str | None = None

    cookie_secure: bool = False
    cookie_samesite: str = "lax"
    cookie_domain: str | None = None
    refresh_cookie_name: str = "cr_refresh"

    # NoDecode: accept the comma list in .env.example as well as the JSON list Compose passes.
    cors_origins: Annotated[list[str], NoDecode] = Field(default_factory=lambda: ["http://localhost:3000"])
    # Host names this API answers to (TrustedHost, Gate 1 M9). "*" = any; set the real API host(s)
    # on a server. Same comma or JSON list format as CORS_ORIGINS.
    allowed_hosts: Annotated[list[str], NoDecode] = Field(default_factory=lambda: ["*"])
    # Proxy addresses whose X-Forwarded-For / -Proto are believed (Gate 1 M11). Empty = ignore
    # those headers and use the socket address. "*" only when the API is reachable solely through
    # the platform's proxy (for example Railway).
    forwarded_allow_ips: str = ""
    # Strict-Transport-Security max-age, sent only when COOKIE_SECURE is true (HTTPS). 0 = off.
    hsts_max_age_seconds: int = 31536000

    storage_backend: str = "local"
    storage_local_path: str = "./var/storage"
    s3_endpoint_url: str | None = None
    s3_access_key: str | None = None
    s3_secret_key: str | None = None
    s3_bucket: str | None = None
    s3_region: str | None = None

    residency_region: str | None = None

    # Audio masters and cover art (owner decisions D-AUDIO-17, S11, S12). Technical limits, config.
    media_master_max_bytes: int = 2 * 1024 * 1024 * 1024
    media_master_max_duration_seconds: int = 3600
    media_cover_max_bytes: int = 20 * 1024 * 1024
    media_cover_min_px: int = 1400
    media_cover_max_px: int = 6000
    upload_part_size_bytes: int = 8 * 1024 * 1024
    upload_intent_ttl_seconds: int = 86400
    upload_max_open_intents: int = 20
    # Media worker (FFmpeg). Path empty = look on PATH. Expected version empty = do not pin (local).
    media_ffmpeg_path: str = ""
    media_ffprobe_path: str = ""
    media_ffmpeg_expected_version: str = ""
    media_job_timeout_seconds: int = 600
    media_job_max_attempts: int = 4
    media_job_backoff_seconds: int = 30

    bootstrap_admin_email: str | None = None
    bootstrap_admin_password: str | None = None

    # Auth controls. 0 = disabled. Do not treat defaults as product lockout/OTP policy.
    auth_rate_limit_max_attempts: int = 0
    auth_rate_limit_window_seconds: int = 0
    # Buyer downloads (D-AUDIO-06): unlimited by policy; this only stops abuse. The numbers are not
    # decided: 0 means the limiter is off, like the other limits.
    download_rate_limit_max: int = 0
    download_rate_limit_window_seconds: int = 0
    verification_challenge_ttl_seconds: int = 0
    # Public web origin used to build links in messages (verification). No trailing slash.
    web_base_url: str = "http://localhost:3000"
    # Google sign-in (OpenID Connect, server-side code flow). Empty client id = feature off.
    # The secret is server-only; never put it in NEXT_PUBLIC_* or the web app.
    google_client_id: str = ""
    google_client_secret: str | None = None
    # Must exactly match an Authorized redirect URI on the Google OAuth client.
    google_redirect_uri: str = "http://localhost:8000/api/v1/auth/google/callback"
    # How long a started Google sign-in may take before its state expires (anti-CSRF window).
    google_state_ttl_seconds: int = 600
    # Bangla QR payment image (owner supplies it later). A web path or URL to the image only; it
    # proves nothing about payment. Empty = no image yet: test servers show a marked placeholder.
    bangla_qr_image_url: str = ""
    # How new payments are taken (Q-PAY-01): "sandbox" (test payments, the default) or
    # "bangla_qr" (real Bangla QR payments confirmed by finance staff). The owner switches it.
    payment_provider: str = "sandbox"
    # Local/dev/test only: where the dev mailbox writes outgoing email (no real provider, OD-08).
    dev_mailbox_path: str = "./var/dev-mailbox"
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

    @field_validator("cors_origins", "allowed_hosts", mode="before")
    @classmethod
    def split_origins(cls, value: object) -> object:
        if isinstance(value, str):
            text = value.strip()
            if text.startswith("["):
                return json.loads(text)
            return [item.strip() for item in text.split(",") if item.strip()]
        return value

    @field_validator("app_env")
    @classmethod
    def normalize_env(cls, value: str) -> str:
        normalized = value.strip().lower()
        aliases = {"dev": "development", "prod": "production", "stage": "staging"}
        return aliases.get(normalized, normalized)

    @field_validator("cookie_samesite")
    @classmethod
    def require_known_samesite(cls, value: str) -> str:
        normalized = value.strip().lower()
        if normalized not in {"lax", "strict", "none"}:
            raise ValueError("COOKIE_SAMESITE must be lax, strict or none")
        return normalized

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

    @field_validator("payment_provider")
    @classmethod
    def require_known_payment_provider(cls, value: str) -> str:
        allowed = {"sandbox", "bangla_qr"}
        if value not in allowed:
            raise ValueError(f"PAYMENT_PROVIDER must be one of {sorted(allowed)}")
        return value

    @model_validator(mode="after")
    def samesite_none_needs_secure(self) -> Settings:
        # Browsers drop a SameSite=None cookie that is not Secure, so sign-in would silently fail.
        if self.cookie_samesite == "none" and not self.cookie_secure:
            raise ValueError("COOKIE_SAMESITE=none requires COOKIE_SECURE=true")
        return self

    @model_validator(mode="after")
    def production_must_not_use_insecure_defaults(self) -> Settings:
        if not self.is_production:
            return self
        if self.jwt_secret in INSECURE_JWT_SECRETS or len(self.jwt_secret) < 32:
            raise ValueError("JWT_SECRET must be a strong unique secret in production")
        signing = {
            "TICKET_SIGNING_SECRET": self.ticket_signing_secret,
            "MEDIA_TOKEN_SECRET": self.media_token_secret,
        }
        for name, value in signing.items():
            if not value or value in INSECURE_JWT_SECRETS or len(value) < 32:
                raise ValueError(f"{name} must be a strong unique secret in production")
        if len({self.jwt_secret, *signing.values()}) != 1 + len(signing):
            raise ValueError("JWT_SECRET, TICKET_SIGNING_SECRET and MEDIA_TOKEN_SECRET must all differ")
        if not self.cookie_secure:
            raise ValueError("COOKIE_SECURE must be true in production")
        if any(host.strip() == "*" for host in self.allowed_hosts):
            raise ValueError("ALLOWED_HOSTS must list the API host name(s) in production")
        if self.storage_backend == "s3" and not self.s3_bucket:
            raise ValueError("S3_BUCKET is required when STORAGE_BACKEND=s3 in production")
        if not self.cors_origins:
            raise ValueError("CORS_ORIGINS must be an explicit origin list in production")
        if any(origin.strip() == "*" for origin in self.cors_origins):
            raise ValueError("CORS_ORIGINS must not use a wildcard in production")
        if self.log_level.upper() == "DEBUG":
            raise ValueError("LOG_LEVEL must not be DEBUG in production")
        if self.google_enabled:
            if not self.google_redirect_uri.startswith("https://"):
                raise ValueError("GOOGLE_REDIRECT_URI must use https in production")
            if not self.web_base_url.startswith("https://"):
                raise ValueError("WEB_BASE_URL must use https in production when Google sign-in is on")
        return self

    @property
    def is_production(self) -> bool:
        return self.app_env in {"prod", "production"}

    @property
    def ticket_secret(self) -> str:
        """HMAC key for ticket QR codes. Production validation guarantees a dedicated one."""
        return self.ticket_signing_secret or self.jwt_secret

    @property
    def media_secret(self) -> str:
        """Key for signed playback and download links. Production guarantees a dedicated one."""
        return self.media_token_secret or self.jwt_secret

    @property
    def google_enabled(self) -> bool:
        return bool(self.google_client_id.strip() and self.google_client_secret)

    @property
    def is_test(self) -> bool:
        return self.app_env == "test"

    @property
    def uses_dev_mailbox(self) -> bool:
        """Non-production environments deliver email to a local dev mailbox (OD-08 has no provider yet)."""
        return self.app_env in {"local", "dev", "test"}

    @property
    def allows_sandbox_payment_confirm(self) -> bool:
        """Owner decision 2026-10-13 (Q-P5-06 partial): a customer may complete a sandbox payment
        themselves only on this machine, dev and test. Everywhere else a payment is confirmed only
        by a signed provider callback."""
        return self.app_env in {"local", "dev", "test"}

    @property
    def exposes_dev_verification_link(self) -> bool:
        """Only on this machine (local) or in tests: hand the verification link back in the API
        response so sign-up can finish without opening the mailbox. Never on a shared server."""
        return self.app_env in {"local", "test"}

    def redis_key(self, *parts: str) -> str:
        tokens = [self.redis_key_prefix, self.app_env, *[str(part) for part in parts if part]]
        return ":".join(tokens)


@lru_cache
def get_settings() -> Settings:
    return Settings()
