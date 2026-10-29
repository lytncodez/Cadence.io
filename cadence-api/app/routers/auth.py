from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..deps import current_user
from ..models import User
from ..schemas import ForgotPasswordIn, LoginIn, LoginOut, PasswordChange, ResetCheckOut, ResetPasswordIn, UserOut
from ..security import create_token, hash_password, password_version, verify_password
from ..services import resets
from ..serializers import user_out

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=LoginOut)
async def login(body: LoginIn, db: AsyncSession = Depends(get_db)):
    user = await db.scalar(select(User).where(func.lower(User.email) == body.email.lower()))
    # Same message for unknown email and wrong password, so accounts can't be probed.
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "That email and password don't match an account.")
    if user.status != "Active":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This account hasn't been activated yet. Ask your admin to resend the invite.")
    user.last_login = datetime.now(timezone.utc)
    await db.commit()
    return LoginOut(access_token=create_token(str(user.id), str(user.pharmacy_id), password_version(user.password_changed_at)), user=user_out(user))


@router.get("/me", response_model=UserOut)
async def me(user: User = Depends(current_user)):
    return user_out(user)


@router.post("/change-password", status_code=204)
async def change_password(body: PasswordChange, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    if not verify_password(body.current, user.password_hash):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Your current password is incorrect.")
    user.password_hash = hash_password(body.next)
    await db.commit()


@router.post("/forgot-password", status_code=204)
async def forgot_password(body: ForgotPasswordIn, db: AsyncSession = Depends(get_db)):
    """Always answers 204, whether or not the email has an account, so it can't be used to find out who uses Cadence."""
    user = await db.scalar(select(User).where(func.lower(User.email) == body.email.lower()))
    if not user or user.status != "Active" or await resets.recently_requested(db, user):
        return
    token = await resets.issue(db, user, "self")
    await resets.email_link(db, user, token)
    await db.commit()


@router.get("/reset-password/{token}", response_model=ResetCheckOut)
async def check_reset(token: str, db: AsyncSession = Depends(get_db)):
    found = await resets.find(db, token)
    if not found:
        return ResetCheckOut(valid=False)
    _, user = found
    return ResetCheckOut(valid=True, name=user.name.split()[0], email=user.email)


@router.post("/reset-password", status_code=204)
async def reset_password(body: ResetPasswordIn, db: AsyncSession = Depends(get_db)):
    found = await resets.find(db, body.token)
    if not found:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This reset link has expired or was already used. Ask for a new one.")
    row, user = found
    now = datetime.now(timezone.utc)
    user.password_hash = hash_password(body.password)
    user.password_changed_at = now  # signs out every existing session
    if user.status == "Invited":
        user.status = "Active"
    row.used_at = now
    await db.commit()
