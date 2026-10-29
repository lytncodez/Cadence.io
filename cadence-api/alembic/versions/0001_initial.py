"""Initial schema: pharmacies, roles, users, products, batches, sales

Revision ID: 0001
Revises:
Create Date: 2026-10-29
"""
import sqlalchemy as sa
from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "pharmacies",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("name", sa.String(160), nullable=False),
        sa.Column("location", sa.String(160), nullable=False, server_default=""),
        sa.Column("licence_no", sa.String(60), nullable=False, server_default=""),
        sa.Column("critical_days", sa.Integer(), nullable=False, server_default="30"),
        sa.Column("soon_days", sa.Integer(), nullable=False, server_default="90"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_table(
        "roles",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("pharmacy_id", sa.Uuid(), sa.ForeignKey("pharmacies.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("name", sa.String(40), nullable=False),
        sa.Column("summary", sa.String(200), nullable=False, server_default=""),
        sa.Column("perms", sa.JSON(), nullable=False),
        sa.Column("locked", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.UniqueConstraint("pharmacy_id", "name"),
    )
    op.create_table(
        "users",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("pharmacy_id", sa.Uuid(), sa.ForeignKey("pharmacies.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("email", sa.String(254), nullable=False, unique=True, index=True),
        sa.Column("password_hash", sa.String(255), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("role", sa.String(40), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="Active"),
        sa.Column("position", sa.String(120), nullable=False, server_default=""),
        sa.Column("staff_id", sa.String(40), nullable=False, server_default=""),
        sa.Column("phone", sa.String(40), nullable=False, server_default=""),
        sa.Column("department", sa.String(80), nullable=False, server_default=""),
        sa.Column("reg_no", sa.String(60), nullable=False, server_default=""),
        sa.Column("bio", sa.Text(), nullable=False, server_default=""),
        sa.Column("photo", sa.Text(), nullable=False, server_default=""),
        sa.Column("joined", sa.Date(), nullable=False, server_default=sa.func.current_date()),
        sa.Column("last_login", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_table(
        "products",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("pharmacy_id", sa.Uuid(), sa.ForeignKey("pharmacies.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("barcode", sa.String(32), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("category", sa.String(80), nullable=False, server_default=""),
        sa.Column("supplier", sa.String(120), nullable=False, server_default=""),
        sa.Column("unit_cost", sa.Numeric(12, 2), nullable=False),
        sa.Column("unit_price", sa.Numeric(12, 2), nullable=False),
        sa.Column("reorder_level", sa.Integer(), nullable=False, server_default="20"),
        sa.UniqueConstraint("pharmacy_id", "barcode"),
    )
    op.create_table(
        "batches",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("product_id", sa.Uuid(), sa.ForeignKey("products.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("batch_no", sa.String(60), nullable=False),
        sa.Column("expiry_date", sa.Date(), nullable=False, index=True),
        sa.Column("qty", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("received_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("product_id", "batch_no"),
        sa.CheckConstraint("qty >= 0", name="ck_batches_qty_nonneg"),
    )
    op.create_table(
        "sales",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("pharmacy_id", sa.Uuid(), sa.ForeignKey("pharmacies.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("batch_id", sa.Uuid(), sa.ForeignKey("batches.id", ondelete="SET NULL"), nullable=True, index=True),
        sa.Column("qty", sa.Integer(), nullable=False),
        sa.Column("unit_price", sa.Numeric(12, 2), nullable=False),
        sa.Column("unit_cost", sa.Numeric(12, 2), nullable=False),
        sa.Column("sold_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now(), index=True),
    )


def downgrade() -> None:
    for t in ("sales", "batches", "products", "users", "roles", "pharmacies"):
        op.drop_table(t)
