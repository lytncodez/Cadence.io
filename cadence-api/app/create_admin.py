"""Create a real pharmacy with its first admin (no demo data).

    python -m app.create_admin
"""
import asyncio
import getpass

from sqlalchemy import func, select

from .db import SessionLocal
from .models import Pharmacy, Role, User
from .security import hash_password
from .seed import ROLES


async def main() -> None:
    name = input("Pharmacy name: ").strip()
    location = input("Location (e.g. Tema, Ghana): ").strip()
    admin_name = input("Admin full name: ").strip()
    email = input("Admin email: ").strip().lower()
    password = getpass.getpass("Admin password (min 10 characters): ")
    if not (name and admin_name and "@" in email) or len(password) < 10:
        raise SystemExit("Missing details, or the password is shorter than 10 characters.")
    async with SessionLocal() as db:
        if await db.scalar(select(User.id).where(func.lower(User.email) == email)):
            raise SystemExit("A user with that email already exists.")
        ph = Pharmacy(name=name, location=location)
        db.add(ph)
        await db.flush()
        for role, summary, perms, locked in ROLES:
            db.add(Role(pharmacy_id=ph.id, name=role, summary=summary, perms=list(perms), locked=locked))
        db.add(User(pharmacy_id=ph.id, email=email, password_hash=hash_password(password), name=admin_name,
                    role="Admin", position="Pharmacy Manager", department="Management"))
        await db.commit()
    print(f"Created {name} with admin {email}. Log in on the web app.")


if __name__ == "__main__":
    asyncio.run(main())
