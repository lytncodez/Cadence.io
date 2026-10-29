"""Deterministic analytics. The AI layer (Phase 3) may explain these numbers but never computes its own."""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..deps import current_user
from ..models import Sale, User
from ..schemas import MonthOut

router = APIRouter(prefix="/analytics", tags=["analytics"])
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def months_back(n: int) -> list[tuple[int, int]]:
    now = datetime.now(timezone.utc)
    y, m = now.year, now.month
    out = []
    for _ in range(n):
        out.append((y, m))
        m -= 1
        if m == 0:
            y, m = y - 1, 12
    return list(reversed(out))


@router.get("/monthly", response_model=list[MonthOut])
async def monthly(months: int = 6, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    """Revenue and cost of goods sold for the last `months` calendar months (oldest first).
    Aggregated in Python so the same code runs on Postgres and on SQLite in tests."""
    window = months_back(max(2, min(months, 24)))
    y0, m0 = window[0]
    start = datetime(y0, m0, 1, tzinfo=timezone.utc)
    rows = (await db.execute(
        select(Sale.sold_at, Sale.qty, Sale.unit_price, Sale.unit_cost)
        .where(Sale.pharmacy_id == user.pharmacy_id, Sale.sold_at >= start)
    )).all()
    totals = {k: [0.0, 0.0] for k in window}
    for sold_at, qty, price, cost in rows:
        key = (sold_at.year, sold_at.month)
        if key in totals:
            totals[key][0] += qty * float(price)
            totals[key][1] += qty * float(cost)
    return [MonthOut(label=MONTHS[m - 1], year=y, revenue=round(totals[(y, m)][0], 2), cost=round(totals[(y, m)][1], 2)) for y, m in window]
