"""Create a Cadence HQ login (for you and your team, not for pharmacies).

    python -m app.create_hq_admin

Run it on your computer with DATABASE_URL in .env pointing at Neon. HQ is at <your site>/hq.
"""
import asyncio
import getpass

from sqlalchemy import func, select

from .db import SessionLocal
from .models import PlatformAdmin
from .security import hash_password


async def main() -> None:
    name = input("Your name: ").strip()
    email = input("HQ login email: ").strip().lower()
    password = getpass.getpass("Password (min 12 characters): ")
    if not name or "@" not in email or len(password) < 12:
        raise SystemExit("Missing details, or the password is shorter than 12 characters.")
    async with SessionLocal() as db:
        existing = await db.scalar(select(PlatformAdmin).where(func.lower(PlatformAdmin.email) == email))
        if existing:
            existing.password_hash = hash_password(password)
            existing.name = name
            msg = f"Updated HQ login for {email}."
        else:
            db.add(PlatformAdmin(email=email, name=name, password_hash=hash_password(password)))
            msg = f"Created HQ login for {email}. Sign in at <your site>/hq."
        await db.commit()
    print(msg)


if __name__ == "__main__":
    asyncio.run(main())
