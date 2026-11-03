"""Encrypt personal data that was saved before DATA_ENCRYPTION_KEY was set, or re-encrypt it with a new key.

    python -m app.encrypt_existing

Safe to run more than once. Uses the first key in DATA_ENCRYPTION_KEY."""
import asyncio

from sqlalchemy import text

from . import crypto
from .db import SessionLocal

TARGETS = {
    "users": ("id", ["phone", "reg_no"]),
    "notification_settings": ("pharmacy_id", ["sms_numbers", "email"]),
    "notification_log": ("id", ["recipient"]),
    "demo_requests": ("id", ["phone", "email", "message"]),
}


async def main() -> None:
    if not crypto.enabled():
        raise SystemExit("Set DATA_ENCRYPTION_KEY first (see app/crypto.py for how to generate one).")
    async with SessionLocal() as db:
        total = 0
        for table, (pk, cols) in TARGETS.items():
            # Raw SQL so we see what's really stored, not the decrypted values.
            rows = (await db.execute(text(f"SELECT {pk}, {', '.join(cols)} FROM {table}"))).all()
            for row in rows:
                updates = {c: crypto.rotate(v) for c, v in zip(cols, row[1:]) if v}
                updates = {c: v for c, v in updates.items() if v != dict(zip(cols, row[1:]))[c]}
                if updates:
                    sets = ", ".join(f"{c} = :{c}" for c in updates)
                    await db.execute(text(f"UPDATE {table} SET {sets} WHERE {pk} = :pk"), {**updates, "pk": row[0]})
                    total += 1
        await db.commit()
    print(f"Done. {total} rows encrypted or re-keyed.")


if __name__ == "__main__":
    asyncio.run(main())
