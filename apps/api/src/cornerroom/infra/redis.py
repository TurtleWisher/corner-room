"""Redis client for cache, rate limits, and arq. Not a source of truth."""

from __future__ import annotations

from redis.asyncio import Redis

from cornerroom.infra.settings import Settings, get_settings

_redis: Redis | None = None


def init_redis(settings: Settings | None = None) -> Redis:
    global _redis
    cfg = settings or get_settings()
    _redis = Redis.from_url(
        cfg.redis_url,
        decode_responses=True,
        socket_connect_timeout=cfg.redis_socket_timeout_seconds,
        socket_timeout=cfg.redis_socket_timeout_seconds,
    )
    return _redis


def get_redis() -> Redis:
    if _redis is None:
        init_redis()
    assert _redis is not None
    return _redis


async def dispose_redis() -> None:
    global _redis
    if _redis is not None:
        await _redis.aclose()
    _redis = None


async def ping_redis() -> bool:
    client = get_redis()
    return bool(await client.ping())


def namespaced_key(*parts: str, settings: Settings | None = None) -> str:
    cfg = settings or get_settings()
    return cfg.redis_key(*parts)
