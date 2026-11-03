from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..deps import current_user
from ..models import User
from .. import ratelimit
from ..config import get_settings
from ..models import Pharmacy
from ..schemas import ForgotPasswordIn, LoginIn, LoginOut, PasswordChange, ResetCheckOut, ResetPasswordIn, SignupIn, UserOut
from ..security import create_token, hash_password, password_version, verify_password
from ..services import resets, usage
from ..services.notify import send_email
from ..services.tenancy import create_pharmacy
from ..serializers import user_out

router = APIRouter(prefix="/auth", tags=["auth"])


def _session(user: User) -> LoginOut:
    return LoginOut(access_token=create_token(str(user.id), str(user.pharmacy_id), password_version(user.password_changed_at)), user=user_out(user))


@router.post("/login", response_model=LoginOut)
async def login(body: LoginIn, request: Request, db: AsyncSession = Depends(get_db)):
    # Slow down password guessing: after 10 wrong passwords for one email from one address, wait 15 minutes.
    key = f"login:{ratelimit.client_ip(request)}:{body.email.lower()}"
    if ratelimit.over(key, 10, 900):
        raise HTTPException(429, "Too many wrong passwords. Wait 15 minutes, or use \"Forgot password\".")
    user = await db.scalar(select(User).where(func.lower(User.email) == body.email.lower()))
    # Same message for unknown email and wrong password, so accounts can't be probed.
    if not user or not verify_password(body.password, user.password_hash):
        ratelimit.hit(key, 10, 900)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "That email and password don't match an account.")
    if user.status == "Suspended":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This account is suspended. Ask your pharmacy admin.")
    if user.status != "Active":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This account hasn't been activated yet. Use the link in your invite email, or ask your admin to resend it.")
    user.last_login = user.last_seen_at = datetime.now(timezone.utc)
    usage.record(db, user.pharmacy_id, "login", user.id)
    await db.commit()
    return _session(user)


@router.post("/signup", response_model=LoginOut, status_code=201)
async def signup(body: SignupIn, request: Request, db: AsyncSession = Depends(get_db)):
    """A new pharmacy creates its own account. It gets its own roles, settings and data, and its first admin is signed in."""
    s = get_settings()
    if not s.signup_enabled:
        raise HTTPException(403, "New accounts are set up by the Cadence team. Book a demo on the website.")
    if body.website:  # honeypot filled in: a bot
        raise HTTPException(400, "Something went wrong. Please try again.")
    ratelimit.enforce(f"signup:{ratelimit.client_ip(request)}", 5, 3600, "Too many sign-ups from this connection. Try again in an hour.")
    email = body.email.lower()
    if await db.scalar(select(User.id).where(func.lower(User.email) == email)):
        raise HTTPException(409, "That email already has a Cadence account. Log in, or use \"Forgot password\".")
    ph, admin = await create_pharmacy(db, name=body.pharmacy_name, location=body.location, licence_no=body.licence_no,
                                      admin_name=body.name, email=email, password=body.password, position=body.position, phone=body.phone)
    admin.last_login = admin.last_seen_at = datetime.now(timezone.utc)
    usage.record(db, ph.id, "signup", admin.id)
    await db.commit()
    if s.demo_notify_email:  # let the Cadence team know a pharmacy joined (best effort)
        await send_email(s.demo_notify_email, f"New pharmacy on Cadence: {ph.name}",
                         f"{ph.name} ({ph.location}) just created an account.\nAdmin: {admin.name} <{admin.email}> {body.phone}")
    return _session(admin)


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
    ph = await db.get(Pharmacy, user.pharmacy_id)
    return ResetCheckOut(valid=True, name=user.name.split()[0], email=user.email, invite=user.status == "Invited", pharmacy=ph.name if ph else "")


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
