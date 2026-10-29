import asyncio

from alembic import context
from sqlalchemy.ext.asyncio import create_async_engine

from app.config import get_settings
from app.db import Base, normalise_url
from app import models  # noqa: F401  (registers tables on Base.metadata)

target_metadata = Base.metadata


def run_offline() -> None:
    url, _ = normalise_url(get_settings().database_url)
    context.configure(url=url, target_metadata=target_metadata, literal_binds=True, compare_type=True)
    with context.begin_transaction():
        context.run_migrations()


def _run(connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata, compare_type=True)
    with context.begin_transaction():
        context.run_migrations()


async def run_online() -> None:
    url, connect_args = normalise_url(get_settings().database_url)
    engine = create_async_engine(url, connect_args=connect_args)
    async with engine.connect() as conn:
        await conn.run_sync(_run)
    await engine.dispose()


if context.is_offline_mode():
    run_offline()
else:
    asyncio.run(run_online())
