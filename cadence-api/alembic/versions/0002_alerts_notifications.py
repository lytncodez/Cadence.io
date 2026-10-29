"""Alerts and notifications: settings per pharmacy, read state per user, delivery log

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-29
"""
import sqlalchemy as sa
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "notification_settings",
        sa.Column("pharmacy_id", sa.Uuid(), sa.ForeignKey("pharmacies.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("sms_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("sms_numbers", sa.String(400), nullable=False, server_default=""),
        sa.Column("email_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("email", sa.String(254), nullable=False, server_default=""),
        sa.Column("digest_time", sa.String(5), nullable=False, server_default="07:30"),
        sa.Column("on_expired", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("on_critical", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("on_soon", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("on_low_stock", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("last_digest_on", sa.Date(), nullable=True),
    )
    op.create_table(
        "alert_reads",
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("key", sa.String(160), primary_key=True),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_table(
        "notification_log",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("pharmacy_id", sa.Uuid(), sa.ForeignKey("pharmacies.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("channel", sa.String(10), nullable=False),
        sa.Column("recipient", sa.String(254), nullable=False),
        sa.Column("subject", sa.String(200), nullable=False, server_default=""),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("status", sa.String(10), nullable=False),
        sa.Column("error", sa.Text(), nullable=False, server_default=""),
        sa.Column("kind", sa.String(20), nullable=False, server_default="digest"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now(), index=True),
    )


def downgrade() -> None:
    for t in ("notification_log", "alert_reads", "notification_settings"):
        op.drop_table(t)
