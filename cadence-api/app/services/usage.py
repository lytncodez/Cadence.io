"""Privacy-safe usage tracking for Cadence HQ: only *that* something happened (kind, count, time), never what."""
from datetime import datetime, timedelta, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from ..models import UsageEvent, User

ACTIVE_EVERY = timedelta(minutes=10)  # one "active" mark per person per 10 minutes is enough for activity charts


def record(db: AsyncSession, pharmacy_id, kind: str, user_id=None, n: int = 1) -> None:
    """Add an event to the session; the caller's commit saves it."""
    db.add(UsageEvent(pharmacy_id=pharmacy_id, user_id=user_id, kind=kind, n=max(1, int(n))))


def _aware(dt: datetime | None) -> datetime | None:
    return dt.replace(tzinfo=timezone.utc) if dt and dt.tzinfo is None else dt


async def touch(db: AsyncSession, user: User) -> None:
    """Called on every signed-in request; writes at most once per ACTIVE_EVERY per person."""
    now = datetime.now(timezone.utc)
    seen = _aware(user.last_seen_at)
    if seen and now - seen < ACTIVE_EVERY:
        return
    user.last_seen_at = now
    record(db, user.pharmacy_id, "active", user.id)
    await db.commit()
