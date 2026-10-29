"""Password reset links, demo requests from the website, and users.password_changed_at

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-29
"""
import sqlalchemy as sa
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("password_changed_at", sa.DateTime(timezone=True), nullable=True))
    op.create_table(
        "password_resets",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("requested_by", sa.String(20), nullable=False, server_default="self"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_password_resets_user_id", "password_resets", ["user_id"])
    op.create_index("ix_password_resets_token_hash", "password_resets", ["token_hash"], unique=True)
    op.create_table(
        "demo_requests",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("pharmacy", sa.String(160), nullable=False),
        sa.Column("phone", sa.String(40), nullable=False),
        sa.Column("email", sa.String(254), nullable=False, server_default=""),
        sa.Column("branches", sa.String(40), nullable=False, server_default=""),
        sa.Column("message", sa.Text(), nullable=False, server_default=""),
        sa.Column("status", sa.String(20), nullable=False, server_default="new"),
        sa.Column("notified", sa.String(200), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("demo_requests")
    op.drop_index("ix_password_resets_token_hash", "password_resets")
    op.drop_index("ix_password_resets_user_id", "password_resets")
    op.drop_table("password_resets")
    op.drop_column("users", "password_changed_at")
