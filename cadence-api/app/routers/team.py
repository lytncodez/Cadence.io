import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..deps import current_user, require, user_perms
from ..models import Pharmacy, Role, User
from ..schemas import PharmacyOut, PharmacyUpdate, RoleOut, UserOut, UserUpdate
from ..serializers import user_out

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
