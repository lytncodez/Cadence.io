"""Seed a demo pharmacy: roles, four staff accounts, 36 batches and six months of sales.

    python -m app.seed            # only if the database is empty
    python -m app.seed --reset    # wipe Cadence tables, then seed again (asks for confirmation)
    python -m app.seed --wipe     # wipe Cadence tables and stop (before going live)

Expiry dates are set relative to today so the statuses look realistic whenever you seed.
"""
import asyncio
import random
import sys
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import delete, select

from .config import get_settings
from .db import SessionLocal
from .models import AlertRead, Batch, NotificationLog, NotificationSettings, Pharmacy, Product, Role, Sale, User
from .security import hash_password

ROWS = [
    # name, category, barcode, batch, days_to_expiry, qty, unit_cost, unit_price, supplier, sold_this_month, reorder_level
    ("Paracetamol 500mg Tabs ×100", "Analgesics", "6034000112011", "PCM-2408", 412, 64, 18.5, 32, "Ernest Chemists", 142, 30),
    ("Paracetamol 500mg Tabs ×100", "Analgesics", "6034000112011", "PCM-2411", 23, 18, 18.5, 32, "Ernest Chemists", 0, 30),
    ("Ibuprofen 400mg Tabs ×24", "Analgesics", "6034000112035", "IBU-2502", 287, 52, 9.8, 18, "Letap Pharma", 88, 25),
    ("Diclofenac 50mg Tabs ×30", "Analgesics", "6034000112059", "DIC-2410", -6, 9, 7.2, 14, "Letap Pharma", 0, 20),
    ("Amoxicillin 500mg Caps ×21", "Antibiotics", "6034000221004", "AMX-2503", 12, 26, 14.9, 28, "Tobinco Pharma", 61, 30),
    ("Amoxicillin 500mg Caps ×21", "Antibiotics", "6034000221004", "AMX-2507", 196, 80, 14.9, 28, "Tobinco Pharma", 0, 30),
    ("Augmentin 625mg Tabs ×14", "Antibiotics", "5000123004512", "AUG-2505", 74, 22, 96, 145, "GSK Ghana", 31, 10),
    ("Ciprofloxacin 500mg Tabs ×10", "Antibiotics", "6034000221028", "CIP-2409", 0, 14, 11.4, 22, "Tobinco Pharma", 0, 15),
    ("Metronidazole 400mg Tabs ×21", "Antibiotics", "6034000221042", "MTZ-2504", 158, 47, 6.3, 12, "Kinapharma", 40, 20),
    ("Coartem 80/480mg ×6", "Antimalarials", "7612797004312", "CTM-2502", 41, 38, 42, 68, "Novartis via M&G", 97, 25),
    ("Lonart DS ×6", "Antimalarials", "8906002961015", "LNT-2506", 233, 55, 21, 38, "Bliss GVS", 76, 25),
    ("Lonart DS ×6", "Antimalarials", "8906002961015", "LNT-2501", 17, 11, 21, 38, "Bliss GVS", 0, 25),
    ("Artesunate 60mg Inj", "Antimalarials", "6034000330017", "ART-2503", 129, 16, 28, 46, "Guilin via Tobinco", 12, 10),
    ("Metformin 500mg Tabs ×28", "Chronic care", "6034000440051", "MET-2412", 64, 70, 8.6, 16, "Ernest Chemists", 118, 40),
    ("Amlodipine 10mg Tabs ×28", "Chronic care", "6034000440075", "AML-2502", 312, 66, 10.2, 20, "Kinapharma", 104, 40),
    ("Lisinopril 10mg Tabs ×28", "Chronic care", "6034000440099", "LIS-2411", 8, 12, 12.8, 24, "Kinapharma", 22, 20),
    ("Atorvastatin 20mg Tabs ×30", "Chronic care", "6034000440112", "ATV-2504", 401, 41, 16.5, 30, "Ernest Chemists", 47, 20),
    ("Insulin Mixtard 30/70 10ml", "Chronic care", "5701234005671", "INS-2503", 52, 8, 118, 165, "Novo Nordisk", 9, 6),
    ("Ventolin Inhaler 100mcg", "Respiratory", "5000123006417", "VEN-2501", 86, 14, 48, 75, "GSK Ghana", 18, 8),
    ("Cetirizine 10mg Tabs ×30", "Respiratory", "6034000550018", "CET-2505", 520, 90, 5.4, 12, "Letap Pharma", 66, 30),
    ("Benylin Cough Syrup 100ml", "Respiratory", "6001067021113", "BNL-2502", 27, 21, 22, 38, "Kenvue", 34, 15),
    ("Benylin Cough Syrup 100ml", "Respiratory", "6001067021113", "BNL-2409", -21, 6, 22, 38, "Kenvue", 0, 15),
    ("ORS Sachets ×10", "Rehydration", "6034000660014", "ORS-2506", 610, 120, 6, 12, "Kinapharma", 73, 40),
    ("Zinc 20mg Dispersible ×10", "Rehydration", "6034000660038", "ZNC-2504", 145, 48, 4.5, 9, "Kinapharma", 29, 20),
    ("Vitamin C 1000mg Effervescent ×20", "Supplements", "4005800123456", "VTC-2503", 58, 33, 19, 35, "Bayer West Africa", 52, 20),
    ("Folic Acid 5mg Tabs ×28", "Supplements", "6034000770011", "FOL-2501", 365, 72, 3.2, 7, "Ernest Chemists", 38, 25),
    ("Ferrous Sulphate 200mg ×28", "Supplements", "6034000770035", "FES-2410", 4, 15, 4.1, 9, "Ernest Chemists", 11, 20),
    ("Omeprazole 20mg Caps ×28", "Gastro", "6034000880017", "OMP-2502", 188, 58, 9.1, 18, "Letap Pharma", 63, 25),
    ("Gaviscon Liquid 200ml", "Gastro", "5011417564781", "GAV-2505", 77, 19, 41, 62, "Reckitt", 23, 10),
    ("Loperamide 2mg Caps ×12", "Gastro", "6034000880031", "LOP-2409", -45, 5, 3.8, 8, "Letap Pharma", 0, 10),
    ("Hydrocortisone 1% Cream 15g", "Dermatology", "6034000990013", "HYD-2503", 241, 27, 8.4, 16, "Kinapharma", 14, 10),
    ("Clotrimazole 1% Cream 20g", "Dermatology", "6034000990037", "CLT-2408", 35, 24, 7.6, 15, "Kinapharma", 19, 10),
    ("Sterile Gauze Swabs ×100", "Consumables", "6034001110016", "GZE-2502", 702, 40, 15, 26, "Medilab Supplies", 21, 15),
    ("Disposable Syringes 5ml ×100", "Consumables", "6034001110030", "SYR-2504", 811, 22, 32, 52, "Medilab Supplies", 15, 10),
    ("Salbutamol 4mg Tabs ×28", "Respiratory", "6034000550032", "SAL-2503", 47, 25, 3.9, 8, "Letap Pharma", 17, 15),
    ("Azithromycin 500mg Tabs ×3", "Antibiotics", "6034000221066", "AZI-2506", 140, 40, 12.5, 24, "Tobinco Pharma", 26, 15),
]

PERMISSIONS = ["view_inventory", "edit_inventory", "delete_inventory", "import", "dispense",
               "view_insights", "view_finance", "manage_alerts", "manage_users", "company"]
ROLES = [
    ("Admin", "Full access to every feature", PERMISSIONS, True),
    ("Pharmacist", "Manages stock, dispenses and reads reports",
     ["view_inventory", "edit_inventory", "import", "dispense", "view_insights", "view_finance", "manage_alerts"], False),
    ("Dispenser", "Views stock, dispenses and clears alerts", ["view_inventory", "dispense"], False),
]
STAFF = [
    # name, email, role, status, position, staff_id, phone, department, reg_no, joined_days_ago, bio
    ("Abena Mensah", "abena@harbourview.example", "Admin", "Active", "Pharmacy Manager", "HVP-001", "+233 24 555 0142", "Management", "", 2050,
     "Runs day-to-day operations, supplier accounts and the monthly stock review."),
    ("Kojo Asante", "kojo@harbourview.example", "Pharmacist", "Active", "Superintendent Pharmacist", "HVP-004", "+233 20 555 0198", "Main dispensary", "PSGH/PH/04417", 1750,
     "Responsible pharmacist on duty. Signs off write-offs and controlled-drug counts."),
    ("Efua Owusu", "efua@harbourview.example", "Dispenser", "Active", "Dispensing Technician", "HVP-009", "+233 27 555 0311", "Main dispensary", "", 1185,
     "Front counter and dispensing. Receives deliveries on Tuesdays and Fridays."),
    ("Yaw Boateng", "yaw@harbourview.example", "Dispenser", "Invited", "Dispensing Assistant", "HVP-012", "+233 55 555 0420", "Back store", "", 3, ""),
]
# Revenue target per month, oldest first; the last entry is the current month.
MONTHLY_REVENUE = [38240, 40110, 39580, 42760, 43920, 47630]


def _month_start(offset: int) -> datetime:
    n = datetime.now(timezone.utc)
    y, m = n.year, n.month - offset
    while m <= 0:
        y, m = y - 1, m + 12
    return datetime(y, m, 1, 9, tzinfo=timezone.utc)


async def seed(reset: bool = False, wipe_only: bool = False) -> None:
    rng = random.Random(2026)
    pw = get_settings().seed_password
    async with SessionLocal() as db:
        if reset:
            for model in (NotificationLog, AlertRead, NotificationSettings, Sale, Batch, Product, User, Role, Pharmacy):
                await db.execute(delete(model))
            await db.commit()
            if wipe_only:
                print("All Cadence data deleted.")
                return
        if await db.scalar(select(Pharmacy.id)):
            print("Database already has data. Run with --reset to start over.")
            return

        ph = Pharmacy(name="Harbour View Pharmacy", location="Tema, Ghana", licence_no="PC/RP/1187/26")
        db.add(ph)
        await db.flush()
        db.add(NotificationSettings(pharmacy_id=ph.id, sms_enabled=True, sms_numbers="+233 24 555 0142, +233 20 555 0198",
                                    email_enabled=True, email="alerts@harbourview.example"))
        for name, summary, perms, locked in ROLES:
            db.add(Role(pharmacy_id=ph.id, name=name, summary=summary, perms=list(perms), locked=locked))
        hashed = hash_password(pw)
        for (name, email, role, status, position, sid, phone, dept, reg, joined_ago, bio) in STAFF:
            db.add(User(pharmacy_id=ph.id, email=email, password_hash=hashed, name=name, role=role, status=status, position=position,
                        staff_id=sid, phone=phone, department=dept, reg_no=reg, bio=bio, joined=date.today() - timedelta(days=joined_ago),
                        last_login=datetime.now(timezone.utc) - timedelta(hours=rng.randint(1, 30)) if status == "Active" else None))

        products: dict[str, Product] = {}
        weights: list[tuple[Batch, Product, int]] = []
        for (name, cat, code, batch_no, days, qty, cost, price, supplier, sold, reorder) in ROWS:
            p = products.get(code)
            if p is None:
                p = Product(pharmacy_id=ph.id, barcode=code, name=name, category=cat, supplier=supplier,
                            unit_cost=cost, unit_price=price, reorder_level=reorder)
                db.add(p)
                products[code] = p
            b = Batch(product=p, batch_no=batch_no, expiry_date=date.today() + timedelta(days=days), qty=qty)
            db.add(b)
            weights.append((b, p, sold))
        await db.flush()

        # Sales: spread each month's revenue across the batches that sell, in proportion to this month's units.
        sellers = [(b, p, w) for b, p, w in weights if w > 0]
        base = sum(float(p.unit_price) * w for _, p, w in sellers)
        today = datetime.now(timezone.utc)
        for i, target in enumerate(MONTHLY_REVENUE):
            offset = len(MONTHLY_REVENUE) - 1 - i
            start = _month_start(offset)
            days_in_window = max(1, (today - start).days) if offset == 0 else 28
            factor = target / base
            for b, p, w in sellers:
                units = max(1, round(w * factor * rng.uniform(0.9, 1.1)))
                # A few sale lines per batch per month, on different days.
                chunks = [units // 3, units // 3, units - 2 * (units // 3)]
                for c in chunks:
                    if c <= 0:
                        continue
                    db.add(Sale(pharmacy_id=ph.id, batch_id=b.id, qty=c, unit_price=p.unit_price, unit_cost=p.unit_cost,
                                sold_at=start + timedelta(days=rng.randint(0, days_in_window - 1), hours=rng.randint(0, 9))))
        await db.commit()
        print(f"Seeded {ph.name}: {len(STAFF)} users, {len(products)} products, {len(ROWS)} batches. Demo password: {pw}")


if __name__ == "__main__":
    wipe = "--wipe" in sys.argv
    reset = "--reset" in sys.argv or wipe
    if reset and input("This deletes all Cadence data in the database. Type RESET to continue: ").strip() != "RESET":
        sys.exit("Cancelled.")
    asyncio.run(seed(reset=reset, wipe_only=wipe))
