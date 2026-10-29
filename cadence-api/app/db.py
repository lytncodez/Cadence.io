"""Async database engine. Accepts a plain Neon URL (postgresql://...?sslmode=require)
and converts it for asyncpg, which takes SSL as a connect argument instead of a query param."""
from collections.abc import AsyncIterator
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from .config import get_settings


def normalise_url(url: str) -> tuple[str, dict]:
    connect_args: dict = {}
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://"):]
    if url.startswith("postgresql://"):
        url = "postgresql+asyncpg://" + url[len("postgresql://"):]
    if url.startswith("postgresql+asyncpg://"):
        parts = urlsplit(url)
        query = dict(parse_qsl(parts.query))
        sslmode = query.pop("sslmode", None)
        query.pop("channel_binding", None)  # Neon adds this; asyncpg doesn't accept it
        if sslmode in {"require", "verify-ca", "verify-full"} or "neon.tech" in parts.netloc:
            connect_args["ssl"] = True
        url = urlunsplit(parts._replace(query=urlencode(query)))
    return url, connect_args


class Base(DeclarativeBase):
    pass


_url, _connect_args = normalise_url(get_settings().database_url)
engine = create_async_engine(
    _url,
    connect_args=_connect_args,
    pool_pre_ping=True,  # Neon closes idle connections; this reconnects quietly
    pool_recycle=300,
)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)


async def get_db() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        yield session
