"""Alembic environment — sync engine for migrations."""

from __future__ import annotations

from logging.config import fileConfig

from alembic import context
from sqlalchemy import MetaData, engine_from_config, pool, text

from cornerroom.infra.base import Base  # noqa: F401 — identifier-length patch
from cornerroom.infra.models import *  # noqa: F401,F403
from cornerroom.infra.settings import get_settings
import os

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

settings = get_settings()
config.set_main_option(
    "sqlalchemy.url",
    os.environ.get("ALEMBIC_DATABASE_URL") or settings.database_url_sync,
)
# Hand-written revisions already name constraints. Copying Base.metadata.naming_convention
# double-prefixes CheckConstraints whose names already include ck_<table>_ (0006/0011),
# so later DROP CONSTRAINT misses (0010/0012). Do not rewrite 0001–0013.
target_metadata = MetaData()

SCHEMAS = ("identity", "permissions", "audit", "notifications", "documents", "infra")


def _ensure_schemas(connection) -> None:
    for schema in SCHEMAS:
        connection.execute(text(f"CREATE SCHEMA IF NOT EXISTS {schema}"))


def _ensure_alembic_version_table(connection) -> None:
    # Alembic's default version_num is VARCHAR(32). Head revision
    # 0014_notifications_search_analytics is 36 characters.
    connection.execute(
        text(
            "CREATE TABLE IF NOT EXISTS infra.alembic_version ("
            "version_num VARCHAR(64) NOT NULL, "
            "CONSTRAINT alembic_version_pkc PRIMARY KEY (version_num))"
        )
    )
    connection.execute(
        text(
            "ALTER TABLE infra.alembic_version "
            "ALTER COLUMN version_num TYPE VARCHAR(64)"
        )
    )


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        include_schemas=True,
        version_table_schema="infra",
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        _ensure_schemas(connection)
        _ensure_alembic_version_table(connection)
        connection.commit()
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            include_schemas=True,
            version_table_schema="infra",
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
