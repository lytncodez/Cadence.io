"""Creating a pharmacy (a tenant). Every row in Cadence belongs to exactly one pharmacy, and every query is
filtered by the signed-in user's pharmacy_id, so pharmacies never see each other's data."""
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import NotificationSettings, Pharmacy, Role, User
from ..security import hash_password

PERMISSIONS = ["view_inventory", "edit_inventory", "delete_inventory", "import", "dispense",
               "view_insights", "view_finance", "manage_alerts", "manage_users", "company"]
ROLES = [
    ("Admin", "Full access to every feature", PERMISSIONS, True),
    ("Pharmacist", "Manages stock, dispenses and reads reports",
     ["view_inventory", "edit_inventory", "import", "dispense", "view_insights", "view_finance", "manage_alerts"], False),
    ("Dispenser", "Views stock, dispenses and clears alerts", ["view_inventory", "dispense"], False),
]


async def create_pharmacy(db: AsyncSession, *, name: str, location: str, licence_no: str, admin_name: str, email: str,
                          password: str, position: str = "Pharmacy Manager", phone: str = "") -> tuple[Pharmacy, User]:
    """New pharmacy with the three standard roles, alert settings and its first admin. Caller commits."""
    ph = Pharmacy(name=name.strip(), location=location.strip(), licence_no=licence_no.strip())
    db.add(ph)
    await db.flush()
    for role, summary, perms, locked in ROLES:
        db.add(Role(pharmacy_id=ph.id, name=role, summary=summary, perms=list(perms), locked=locked))
    db.add(NotificationSettings(pharmacy_id=ph.id, sms_enabled=bool(phone), sms_numbers=phone, email_enabled=True, email=email))
    admin = User(pharmacy_id=ph.id, email=email.strip().lower(), password_hash=hash_password(password), name=admin_name.strip(),
                 role="Admin", status="Active", position=position.strip() or "Pharmacy Manager", department="Management",
                 phone=phone, staff_id="ADM-001")
    db.add(admin)
    await db.flush()
    return ph, admin
