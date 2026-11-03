"""Widen personal-data columns to TEXT so they can hold encrypted values

Revision ID: 0004
Revises: 0003
Create Date: 2026-11-02

Encryption itself happens in the app (app/crypto.py). After upgrading, run
`python -m app.encrypt_existing` once to encrypt rows written before this version.
"""
import sqlalchemy as sa
from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None

COLUMNS = {
    "users": [("phone", sa.String(40)), ("reg_no", sa.String(60))],
    "notification_settings": [("sms_numbers", sa.String(400)), ("email", sa.String(254))],
    "notification_log": [("recipient", sa.String(254))],
    "demo_requests": [("phone", sa.String(40)), ("email", sa.String(254))],
}


def upgrade() -> None:
    for table, cols in COLUMNS.items():
        with op.batch_alter_table(table) as b:
            for name, old in cols:
                b.alter_column(name, type_=sa.Text(), existing_type=old)


def downgrade() -> None:
    # Only safe after decrypting (encrypted values are longer than the old limits).
    for table, cols in COLUMNS.items():
        with op.batch_alter_table(table) as b:
            for name, old in cols:
                b.alter_column(name, type_=old, existing_type=sa.Text())
