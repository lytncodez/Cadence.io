"""Deterministic analytics for one pharmacy. Every number the AI or the alerts mention comes from here.
Mirrors cadence-web/src/lib/analytics.ts so the server and the browser always agree."""
from dataclasses import dataclass, field
from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Batch, Pharmacy, Product
from ..routers.analytics import monthly as monthly_route  # reuse the month aggregation
from ..serializers import sold_this_month

STATUS_ORDER = ["expired", "critical", "soon", "safe"]
STATUS_LABEL = {"expired": "Expired", "critical": "Critical", "soon": "Expiring soon", "safe": "Safe"}


def status_for(days: int, critical: int, soon: int) -> str:
    if days <= 0:
        return "expired"
    if days <= critical:
        return "critical"
    if days <= soon:
        return "soon"
    return "safe"


@dataclass
class Row:
    id: str
    name: str
    category: str
    barcode: str
    batch: str
    expiry: date
    days: int
    status: str
    qty: int
    unit_cost: float
    unit_price: float
    sold: int
    reorder_level: int

    @property
    def value(self) -> float:
        return self.qty * self.unit_cost


@dataclass
class ProductRollup:
    name: str
    category: str
    usable: int = 0
    sold: int = 0
    revenue: float = 0.0
    cost: float = 0.0
    price: float = 0.0
    reorder_level: int = 0
    batches: list[Row] = field(default_factory=list)

    @property
    def margin(self) -> float:
        return (self.price - self.cost) / self.price * 100 if self.price else 0.0


@dataclass
class Summary:
    pharmacy: str
    critical_days: int
    soon_days: int
    rows: list[Row]
    counts: dict[str, int]
    value: dict[str, float]
    products: list[ProductRollup]
    months: list[dict]
    has_history: bool = True  # False for an uploaded file analysed on its own (no month-by-month sales)

    @property
    def top(self) -> list[ProductRollup]:
        return sorted(self.products, key=lambda p: -p.revenue)[:5]

    @property
    def low_stock(self) -> list[ProductRollup]:
        return sorted([p for p in self.products if p.usable < p.reorder_level], key=lambda p: p.usable / max(p.reorder_level, 1))

    @property
    def stock_value(self) -> float:
        return sum(r.value for r in self.rows if r.status != "expired")

    @property
    def kpi(self) -> dict:
        cur, prev = self.months[-1], self.months[-2]
        gp, gpp = cur["revenue"] - cur["cost"], prev["revenue"] - prev["cost"]
        pct = lambda a, b: (a - b) / b * 100 if b else 0.0  # noqa: E731
        margin = gp / cur["revenue"] * 100 if cur["revenue"] else 0.0
        margin_prev = gpp / prev["revenue"] * 100 if prev["revenue"] else 0.0
        return {
            "month": cur["label"], "revenue": cur["revenue"], "revenue_delta": pct(cur["revenue"], prev["revenue"]),
            "cost": cur["cost"], "profit": gp, "profit_delta": pct(gp, gpp), "margin": margin, "margin_delta": margin - margin_prev,
        }


async def summarize(db: AsyncSession, user) -> Summary:
    ph = await db.get(Pharmacy, user.pharmacy_id)
    batches = (await db.scalars(
        select(Batch).join(Product).where(Product.pharmacy_id == user.pharmacy_id).order_by(Batch.expiry_date)
    )).unique().all()
    sold = await sold_this_month(db, [b.id for b in batches])
    today = date.today()
    rows: list[Row] = []
    for b in batches:
        days = (b.expiry_date - today).days
        p = b.product
        rows.append(Row(str(b.id), p.name, p.category, p.barcode, b.batch_no, b.expiry_date, days,
                        status_for(days, ph.critical_days, ph.soon_days), b.qty, float(p.unit_cost), float(p.unit_price),
                        sold.get(b.id, 0), p.reorder_level))
    counts = {s: 0 for s in STATUS_ORDER}
    value = {s: 0.0 for s in STATUS_ORDER}
    products: dict[str, ProductRollup] = {}
    for r in rows:
        counts[r.status] += 1
        value[r.status] += r.value
        pr = products.setdefault(r.barcode, ProductRollup(r.name, r.category, cost=r.unit_cost, price=r.unit_price, reorder_level=r.reorder_level))
        if r.status != "expired":
            pr.usable += r.qty
        pr.sold += r.sold
        pr.revenue += r.sold * r.unit_price
        pr.batches.append(r)
    months = [m.model_dump() for m in await monthly_route(6, user, db)]
    return Summary(ph.name, ph.critical_days, ph.soon_days, rows, counts, value, list(products.values()), months)


def _rollup(rows: list[Row]) -> tuple[dict, dict, list[ProductRollup]]:
    counts = {s: 0 for s in STATUS_ORDER}
    value = {s: 0.0 for s in STATUS_ORDER}
    products: dict[str, ProductRollup] = {}
    for r in rows:
        counts[r.status] += 1
        value[r.status] += r.value
        pr = products.setdefault(r.barcode, ProductRollup(r.name, r.category, cost=r.unit_cost, price=r.unit_price, reorder_level=r.reorder_level))
        if r.status != "expired":
            pr.usable += r.qty
        pr.sold += r.sold
        pr.revenue += r.sold * r.unit_price
        pr.batches.append(r)
    return counts, value, list(products.values())


def summarize_rows(items: list, name: str, critical: int, soon: int) -> Summary:
    """Analyse an uploaded file without touching the database. `items` are validated ItemCreate rows."""
    today = date.today()
    rows = []
    for i, it in enumerate(sorted(items, key=lambda x: x.expiry)):
        days = (it.expiry - today).days
        rows.append(Row(f"upload-{i}", it.name, it.category, it.barcode, it.batch, it.expiry, days, status_for(days, critical, soon),
                        it.qty, float(it.unit_cost), float(it.unit_price), int(it.sold_this_month or 0),
                        it.reorder_level if it.reorder_level is not None else 20))
    counts, value, products = _rollup(rows)
    rev = sum(r.sold * r.unit_price for r in rows)
    cost = sum(r.sold * r.unit_cost for r in rows)
    label = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][today.month - 1]
    months = [{"label": "prev", "year": today.year, "revenue": 0.0, "cost": 0.0}, {"label": label, "year": today.year, "revenue": rev, "cost": cost}]
    return Summary(name, critical, soon, rows, counts, value, products, months, has_history=False)


def money(n: float) -> str:
    return f"₵{n:,.0f}" if abs(n) >= 100 else f"₵{n:,.2f}"
