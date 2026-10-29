"""Password-reset links.

A link carries a random token. Only its SHA-256 is stored, it works once, and it expires after
RESET_LINK_MINUTES. Asking for a new link cancels any older unused one."""
import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import get_settings
from ..models import Pharmacy, PasswordReset, User
from .notify import log, send_email


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def link_for(token: str) -> str:
    return f"{get_settings().app_url.rstrip('/')}/reset-password?token={token}"


async def recently_requested(db: AsyncSession, user: User, seconds: int = 60) -> bool:
    last = await db.scalar(select(PasswordReset.created_at).where(PasswordReset.user_id == user.id).order_by(PasswordReset.created_at.desc()).limit(1))
    return bool(last and datetime.now(timezone.utc) - _aware(last) < timedelta(seconds=seconds))


async def issue(db: AsyncSession, user: User, requested_by: str = "self") -> str:
    now = datetime.now(timezone.utc)
    await db.execute(update(PasswordReset).where(PasswordReset.user_id == user.id, PasswordReset.used_at.is_(None)).values(used_at=now))
    token = secrets.token_urlsafe(32)
    db.add(PasswordReset(user_id=user.id, token_hash=_hash(token), requested_by=requested_by,
                         expires_at=now + timedelta(minutes=get_settings().reset_link_minutes)))
    await db.flush()
    return token


async def find(db: AsyncSession, token: str) -> tuple[PasswordReset, User] | None:
    row = await db.scalar(select(PasswordReset).where(PasswordReset.token_hash == _hash(token)))
    if not row or row.used_at is not None or _aware(row.expires_at) < datetime.now(timezone.utc):
        return None
    user = await db.get(User, row.user_id)
    if not user or user.status == "Suspended":
        return None
    return row, user


async def email_link(db: AsyncSession, user: User, token: str, by_admin: str | None = None) -> tuple[str, str]:
    """Send the reset email. The delivery log records that a link went out, never the link itself."""
    ph = await db.get(Pharmacy, user.pharmacy_id)
    minutes = get_settings().reset_link_minutes
    first = user.name.split()[0] if user.name else "there"
    intro = (f"{by_admin} asked Cadence to send you a link to set a new password." if by_admin
             else "Someone (hopefully you) asked to reset your Cadence password.")
    body = (f"Hi {first},\n\n{intro}\n\nSet a new password here (the link works once and expires in {minutes} minutes):\n"
            f"{link_for(token)}\n\nIf you didn't ask for this, ignore this email. Your password stays the same.\n\n"
            f"Cadence.io · {ph.name if ph else ''}")
    status, error = await send_email(user.email, "Reset your Cadence password", body)
    await log(db, user.pharmacy_id, "email", user.email, "Password reset link", status, error, "reset", subject="Reset your Cadence password")
    return status, error
