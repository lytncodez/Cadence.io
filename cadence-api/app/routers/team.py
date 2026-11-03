import secrets
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..deps import current_user, require, user_perms
from ..models import Pharmacy, Role, User
from ..schemas import InviteIn, InviteOut, PharmacyOut, PharmacyUpdate, ResetLinkOut, RoleOut, UserOut, UserUpdate
from ..security import hash_password
from ..serializers import user_out
from ..services import resets

router = APIRouter(tags=["team"])
ADMIN_FIELDS = {"position", "department", "role", "status"}


@router.get("/users", response_model=list[UserOut])
async def list_users(user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    users = (await db.scalars(select(User).where(User.pharmacy_id == user.pharmacy_id).order_by(User.joined))).all()
    return [user_out(u) for u in users]


@router.patch("/users/{user_id}", response_model=UserOut)
async def update_user(user_id: str, body: UserUpdate, me: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    try:
        target = await db.get(User, uuid.UUID(user_id))
    except ValueError:
        target = None
    if not target or target.pharmacy_id != me.pharmacy_id:
        raise HTTPException(404, "That person isn't on your team.")
    data = body.model_dump(exclude_unset=True)
    is_admin = "manage_users" in await user_perms(db, me)
    if target.id != me.id and not is_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only admins can edit other people's profiles.")
    if ADMIN_FIELDS & data.keys() and not is_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Your admin sets position, department and role.")
    if "status" in data and target.id == me.id and data["status"] != "Active":
        raise HTTPException(400, "You can't suspend your own account.")
    if target.role == "Admin" and (data.get("role", "Admin") != "Admin" or data.get("status", "Active") == "Suspended"):
        admins = await db.scalar(select(func.count()).select_from(User).where(
            User.pharmacy_id == me.pharmacy_id, User.role == "Admin", User.status == "Active"))
        if admins <= 1:
            raise HTTPException(400, "Every pharmacy needs at least one active admin. Make someone else an admin first.")
    if "role" in data:
        if target.id == me.id:
            raise HTTPException(400, "You can't change your own role. Ask another admin.")
        if not await db.scalar(select(Role.id).where(Role.pharmacy_id == me.pharmacy_id, Role.name == data["role"])):
            raise HTTPException(400, "That role doesn't exist.")
    for k, v in data.items():
        if v is not None:
            setattr(target, k, v.strip() if isinstance(v, str) and k != "photo" else v)
    await db.commit()
    await db.refresh(target)
    return user_out(target)


@router.get("/roles", response_model=list[RoleOut])
async def list_roles(user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    roles = (await db.scalars(select(Role).where(Role.pharmacy_id == user.pharmacy_id))).all()
    order = {"Admin": 0, "Pharmacist": 1, "Dispenser": 2}
    return [RoleOut.model_validate(r) for r in sorted(roles, key=lambda r: order.get(r.name, 9))]


@router.get("/pharmacy", response_model=PharmacyOut)
async def get_pharmacy(user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    """The signed-in user's pharmacy, including its expiry thresholds."""
    return PharmacyOut.model_validate(await db.get(Pharmacy, user.pharmacy_id))


@router.patch("/pharmacy", response_model=PharmacyOut)
async def update_pharmacy(body: PharmacyUpdate, user: User = Depends(require("company")), db: AsyncSession = Depends(get_db)):
    ph = await db.get(Pharmacy, user.pharmacy_id)
    data = body.model_dump(exclude_unset=True)
    for k, v in data.items():
        if v is not None:
            setattr(ph, k, v.strip() if isinstance(v, str) else v)
    if ph.soon_days <= ph.critical_days:
        raise HTTPException(400, "\"Expiring soon\" must be longer than \"Critical\".")
    await db.commit()
    return PharmacyOut.model_validate(ph)


@router.post("/users/{user_id}/send-reset", response_model=ResetLinkOut)
async def send_reset(user_id: str, me: User = Depends(require("manage_users")), db: AsyncSession = Depends(get_db)):
    """Admin: email someone on the team a link to set a new password. Admins never see or choose the password."""
    try:
        target = await db.get(User, uuid.UUID(user_id))
    except ValueError:
        target = None
    if not target or target.pharmacy_id != me.pharmacy_id:
        raise HTTPException(404, "That person isn't on your team.")
    if target.status == "Suspended":
        raise HTTPException(400, "This account is suspended. Set it to Active first.")
    token = await resets.issue(db, target, "admin")
    status_, error = await resets.email_link(db, target, token, by_admin=me.name)
    await db.commit()
    return ResetLinkOut(status=status_, detail=error, email=target.email, expires_minutes=resets.minutes_for(target),
                        link=None if status_ == "sent" else resets.link_for(token))


@router.post("/users", response_model=InviteOut, status_code=201)
async def invite_user(body: InviteIn, me: User = Depends(require("manage_users")), db: AsyncSession = Depends(get_db)):
    """Admin adds someone to their pharmacy. They get an email link to set their own password (valid 3 days);
    if the email can't be sent, the link comes back so the admin can pass it on."""
    email = body.email.lower()
    if await db.scalar(select(User.id).where(func.lower(User.email) == email)):
        raise HTTPException(409, "That email already has a Cadence account. Each person signs in with their own email.")
    if not await db.scalar(select(Role.id).where(Role.pharmacy_id == me.pharmacy_id, Role.name == body.role)):
        raise HTTPException(400, "That role doesn't exist.")
    count = await db.scalar(select(func.count()).select_from(User).where(User.pharmacy_id == me.pharmacy_id))
    user = User(pharmacy_id=me.pharmacy_id, email=email, name=body.name.strip(), role=body.role, status="Invited",
                position=body.position.strip(), department=body.department.strip(), phone=body.phone.strip(),
                staff_id=f"STF-{count + 1:03d}",
                password_hash=hash_password(secrets.token_urlsafe(32)))  # unusable until they set their own
    db.add(user)
    await db.flush()
    token = await resets.issue(db, user, "admin")
    status_, error = await resets.email_link(db, user, token, by_admin=me.name)
    await db.commit()
    await db.refresh(user)
    return InviteOut(user=user_out(user), delivery=ResetLinkOut(
        status=status_, detail=error, email=user.email, expires_minutes=resets.minutes_for(user),
        link=None if status_ == "sent" else resets.link_for(token)))
