"""Batches ("items" in the frontend). A batch is created under the product that owns its barcode;
the product is created on first sight and its name, prices and supplier follow the latest entry."""
import uuid

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..deps import current_user, require
from ..models import Batch, Product, User
from ..schemas import ItemCreate, ItemOut, ItemUpdate
from ..serializers import item_out, sold_this_month

router = APIRouter(prefix="/items", tags=["items"])


async def _get_batch(db: AsyncSession, user: User, item_id: str) -> Batch:
    try:
        bid = uuid.UUID(item_id)
    except ValueError:
        raise HTTPException(404, "That batch doesn't exist.")
    b = await db.scalar(select(Batch).join(Product).where(Batch.id == bid, Product.pharmacy_id == user.pharmacy_id))
    if not b:
        raise HTTPException(404, "That batch doesn't exist.")
    return b


@router.get("", response_model=list[ItemOut])
async def list_items(user: User = Depends(require("view_inventory")), db: AsyncSession = Depends(get_db)):
    batches = (await db.scalars(
        select(Batch).join(Product).where(Product.pharmacy_id == user.pharmacy_id).order_by(Batch.expiry_date)
    )).unique().all()
    sold = await sold_this_month(db, [b.id for b in batches])
    return [item_out(b, sold.get(b.id, 0)) for b in batches]


@router.get("/barcode/{code}", response_model=list[ItemOut])
async def by_barcode(code: str, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    """Every batch of the product with this barcode, first-expiry-first-out."""
    batches = (await db.scalars(
        select(Batch).join(Product).where(Product.pharmacy_id == user.pharmacy_id, Product.barcode == code.strip()).order_by(Batch.expiry_date)
    )).unique().all()
    return [item_out(b) for b in batches]


@router.post("", response_model=ItemOut, status_code=201)
async def create_item(body: ItemCreate, user: User = Depends(require("edit_inventory")), db: AsyncSession = Depends(get_db)):
    product = await db.scalar(select(Product).where(Product.pharmacy_id == user.pharmacy_id, Product.barcode == body.barcode))
    if product is None:
        product = Product(pharmacy_id=user.pharmacy_id, barcode=body.barcode, name=body.name, category=body.category,
                          supplier=body.supplier, unit_cost=body.unit_cost, unit_price=body.unit_price,
                          reorder_level=body.reorder_level if body.reorder_level is not None else 20)
        db.add(product)
        await db.flush()
    else:
        product.name, product.category = body.name, body.category or product.category
        product.unit_cost, product.unit_price = body.unit_cost, body.unit_price
        product.supplier = body.supplier or product.supplier
        exists = await db.scalar(select(Batch.id).where(Batch.product_id == product.id, Batch.batch_no.ilike(body.batch)))
        if exists:
            raise HTTPException(status.HTTP_409_CONFLICT, f"Batch {body.batch} already exists for this barcode. Edit that row instead.")
    batch = Batch(product_id=product.id, batch_no=body.batch, expiry_date=body.expiry, qty=body.qty)
    db.add(batch)
    await db.commit()
    await db.refresh(batch, ["product"])
    return item_out(batch)


@router.patch("/{item_id}", response_model=ItemOut)
async def update_item(item_id: str, body: ItemUpdate, user: User = Depends(require("edit_inventory")), db: AsyncSession = Depends(get_db)):
    b = await _get_batch(db, user, item_id)
    data = body.model_dump(exclude_unset=True)
    p = b.product
    for k_api, k_db, target in [("batch", "batch_no", b), ("expiry", "expiry_date", b), ("qty", "qty", b),
                                ("name", "name", p), ("category", "category", p), ("supplier", "supplier", p),
                                ("unit_cost", "unit_cost", p), ("unit_price", "unit_price", p), ("reorder_level", "reorder_level", p)]:
        if k_api in data and data[k_api] is not None:
            setattr(target, k_db, data[k_api])
    if float(p.unit_price) < float(p.unit_cost):
        raise HTTPException(422, "Selling price is below unit cost")
    await db.commit()
    await db.refresh(b, ["product"])
    sold = await sold_this_month(db, [b.id])
    return item_out(b, sold.get(b.id, 0))


@router.delete("/{item_id}", status_code=204)
async def delete_item(item_id: str, user: User = Depends(require("delete_inventory")), db: AsyncSession = Depends(get_db)):
    b = await _get_batch(db, user, item_id)
    await db.delete(b)
    await db.commit()
    return Response(status_code=204)
