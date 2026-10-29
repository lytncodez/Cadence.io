"""Turn ORM rows into the camelCase shapes the frontend expects."""
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import Batch, Sale, User
from .schemas import ItemOut, UserOut


def month_start() -> datetime:
    n = datetime.now(timezone.utc)
    return n.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


async def sold_this_month(db: AsyncSession, batch_ids: list) -> dict:
    if not batch_ids:
        return {}
    rows = await db.execute(
        select(Sale.batch_id, func.coalesce(func.sum(Sale.qty), 0))
        .where(Sale.batch_id.in_(batch_ids), Sale.sold_at >= month_start())
        .group_by(Sale.batch_id)
    )
    return {bid: int(total) for bid, total in rows.all()}


def item_out(b: Batch, sold: int = 0) -> ItemOut:
    p = b.product
    return ItemOut(
        id=str(b.id), name=p.name, category=p.category, barcode=p.barcode, batch=b.batch_no, expiry=b.expiry_date,
        qty=b.qty, unit_cost=float(p.unit_cost), unit_price=float(p.unit_price), supplier=p.supplier or "—",
        sold_this_month=sold, reorder_level=p.reorder_level,
    )


def user_out(u: User) -> UserOut:
    return UserOut(
        id=str(u.id), name=u.name, email=u.email, role=u.role, status=u.status, position=u.position, staff_id=u.staff_id,
        phone=u.phone, department=u.department, reg_no=u.reg_no, joined=u.joined.isoformat(),
        last_login=u.last_login.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M") if u.last_login else "",
        photo=u.photo, bio=u.bio,
    )
