import uuid
from collections.abc import Callable

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .db import get_db
from .models import Role, User
from .security import decode_token, password_version

bearer = HTTPBearer(auto_error=False)


async def current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: AsyncSession = Depends(get_db),
) -> User:
    unauthorised = HTTPException(status.HTTP_401_UNAUTHORIZED, "Log in to continue.", headers={"WWW-Authenticate": "Bearer"})
    if not creds:
        raise unauthorised
    try:
        payload = decode_token(creds.credentials)
        user_id = uuid.UUID(payload["sub"])
    except (jwt.PyJWTError, KeyError, ValueError):
        raise unauthorised
    user = await db.get(User, user_id)
    if not user or user.status != "Active":
        raise unauthorised
    # A password reset signs out every device that was logged in before it.
    if payload.get("pv", 0) != password_version(user.password_changed_at):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Your password was changed. Log in again.", headers={"WWW-Authenticate": "Bearer"})
    return user


async def user_perms(db: AsyncSession, user: User) -> set[str]:
    role = await db.scalar(select(Role).where(Role.pharmacy_id == user.pharmacy_id, Role.name == user.role))
    return set(role.perms) if role else set()


def require(*perms: str) -> Callable:
    """Dependency: the signed-in user's role must grant at least one of `perms`."""

    async def checker(user: User = Depends(current_user), db: AsyncSession = Depends(get_db)) -> User:
        granted = await user_perms(db, user)
        if not granted.intersection(perms):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Your role doesn't allow this. Ask your pharmacy admin.")
        return user

    return checker
