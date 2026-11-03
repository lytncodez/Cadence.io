"""Cadence HQ: platform admins, privacy-safe usage events, support (distress) tickets, users.last_seen_at

Revision ID: 0005
Revises: 0004
Create Date: 2026-11-03
"""
import sqlalchemy as sa
from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True))
    op.create_table(
        "platform_admins",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("email", sa.String(254), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("password_hash", sa.String(255), nullable=False),
        sa.Column("last_login", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_platform_admins_email", "platform_admins", ["email"], unique=True)
    op.create_table(
        "usage_events",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("pharmacy_id", sa.Uuid(), sa.ForeignKey("pharmacies.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("kind", sa.String(30), nullable=False),
        sa.Column("n", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_usage_events_pharmacy_id", "usage_events", ["pharmacy_id"])
    op.create_index("ix_usage_events_created_at", "usage_events", ["created_at"])
    op.create_table(
        "support_tickets",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("pharmacy_id", sa.Uuid(), sa.ForeignKey("pharmacies.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("category", sa.String(40), nullable=False),
        sa.Column("urgency", sa.String(10), nullable=False, server_default="normal"),
        sa.Column("message", sa.Text(), nullable=False, server_default=""),
        sa.Column("phone", sa.Text(), nullable=False, server_default=""),
        sa.Column("status", sa.String(20), nullable=False, server_default="open"),
        sa.Column("reply", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_support_tickets_pharmacy_id", "support_tickets", ["pharmacy_id"])
    op.create_index("ix_support_tickets_created_at", "support_tickets", ["created_at"])


def downgrade() -> None:
    op.drop_table("support_tickets")
    op.drop_table("usage_events")
    op.drop_table("platform_admins")
    op.drop_column("users", "last_seen_at")
