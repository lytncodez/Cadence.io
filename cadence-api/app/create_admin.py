"""Create a real pharmacy with its first admin (no demo data).

    python -m app.create_admin
"""
import asyncio
import getpass

from sqlalchemy import func, select

from .db import SessionLocal
from .models import User
from .services.tenancy import create_pharmacy


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
        await create_pharmacy(db, name=name, location=location, licence_no="", admin_name=admin_name, email=email, password=password)
        await db.commit()
    print(f"Created {name} with admin {email}. Log in on the web app.")


if __name__ == "__main__":
    asyncio.run(main())
