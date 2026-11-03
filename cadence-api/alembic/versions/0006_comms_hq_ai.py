"""Alerts to chosen staff, weekly AI report, HQ announcements and HQ delivery log

Revision ID: 0006
Revises: 0005
Create Date: 2026-11-03
"""
import sqlalchemy as sa
from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("notification_settings") as b:
        b.add_column(sa.Column("sms_user_ids", sa.JSON(), nullable=False, server_default="[]"))
        b.add_column(sa.Column("email_user_ids", sa.JSON(), nullable=False, server_default="[]"))
        b.add_column(sa.Column("weekly_enabled", sa.Boolean(), nullable=False, server_default=sa.true()))
        b.add_column(sa.Column("weekly_day", sa.Integer(), nullable=False, server_default="0"))
        b.add_column(sa.Column("last_weekly_on", sa.Date(), nullable=True))
    op.create_table(
        "announcements",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("title", sa.String(160), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("sms_text", sa.String(480), nullable=False, server_default=""),
        sa.Column("channels", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("audience", sa.String(20), nullable=False, server_default="all"),
        sa.Column("pharmacy_ids", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("results", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("sent_by", sa.String(120), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_announcements_created_at", "announcements", ["created_at"])
    op.create_table(
        "hq_deliveries",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("channel", sa.String(10), nullable=False),
        sa.Column("recipient", sa.Text(), nullable=False, server_default=""),
        sa.Column("subject", sa.String(200), nullable=False, server_default=""),
        sa.Column("message", sa.Text(), nullable=False, server_default=""),
        sa.Column("status", sa.String(10), nullable=False),
        sa.Column("error", sa.Text(), nullable=False, server_default=""),
        sa.Column("kind", sa.String(20), nullable=False, server_default="test"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_hq_deliveries_created_at", "hq_deliveries", ["created_at"])


def downgrade() -> None:
    op.drop_table("hq_deliveries")
    op.drop_table("announcements")
    with op.batch_alter_table("notification_settings") as b:
        for c in ("last_weekly_on", "weekly_day", "weekly_enabled", "email_user_ids", "sms_user_ids"):
            b.drop_column(c)
