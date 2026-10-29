"""List demo requests from the website.

    python -m app.leads              # newest 30
    python -m app.leads --all
    python -m app.leads --csv > leads.csv
"""
import asyncio
import csv
import sys

from sqlalchemy import select

from .db import SessionLocal
from .models import DemoRequest


async def main() -> None:
    async with SessionLocal() as db:
        q = select(DemoRequest).order_by(DemoRequest.created_at.desc())
        if "--all" not in sys.argv and "--csv" not in sys.argv:
            q = q.limit(30)
        rows = (await db.scalars(q)).all()
    if "--csv" in sys.argv:
        w = csv.writer(sys.stdout)
        w.writerow(["created_at", "name", "pharmacy", "phone", "email", "branches", "message", "status"])
        for r in rows:
            w.writerow([r.created_at.isoformat(), r.name, r.pharmacy, r.phone, r.email, r.branches, r.message, r.status])
        return
    if not rows:
        print("No demo requests yet.")
    for r in rows:
        print(f"{r.created_at:%Y-%m-%d %H:%M}  {r.pharmacy:<28} {r.name:<22} {r.phone:<16} {r.email or '-':<28} {r.branches}")


if __name__ == "__main__":
    asyncio.run(main())
